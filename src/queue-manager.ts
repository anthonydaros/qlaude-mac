import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import { logger } from './utils/logger.js';
import type { QueueItem, QueueEvent, QueueManagerEvents, ReloadResult, AddItemOptions } from './types/queue.js';

// Known queue file directives (@ prefix)
const KNOWN_QUEUE_DIRECTIVES = ['new', 'save', 'load', 'pause', 'model', 'delay'];
// Interactive-only commands that should NOT appear in queue files
const INTERACTIVE_ONLY_DIRECTIVES = ['add', 'drop', 'clear', 'resume', 'reload', 'status', 'help', 'list'];

const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 100;

/**
 * Delay helper for retry logic
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Type-safe EventEmitter wrapper for QueueManager
 */
interface TypedEventEmitter<T> {
  on<K extends keyof T>(event: K, listener: T[K]): this;
  emit<K extends keyof T>(event: K, ...args: Parameters<T[K] extends (...args: infer P) => unknown ? (...args: P) => unknown : never>): boolean;
}

/**
 * QueueManager handles reading and writing queue files
 * Each line in the queue file represents a single prompt (bare text)
 * Lines prefixed with '@' are directives (@new, @save, @load, @pause, etc.)
 * Lines starting with '\@' are escaped (literal @ in prompt)
 */
export class QueueManager extends (EventEmitter as new () => EventEmitter & TypedEventEmitter<QueueManagerEvents>) {
  private items: QueueItem[] = [];
  private filePath: string;
  private fileErrorState: boolean = false;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(filePath: string = '.qlaude/queue') {
    super();
    this.filePath = filePath;
  }

  /**
   * Serialize mutating file operations to avoid read-modify-write races.
   */
  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  /**
   * Handle file recovery - emit event if recovering from error state
   */
  private handleFileRecovery(): void {
    if (this.fileErrorState) {
      this.fileErrorState = false;
      this.emit('file_recovered');
      logger.info({ filePath: this.filePath }, 'Queue file recovered');
    }
  }

  /**
   * Load queue from file
   * Returns fileFound status and count of skipped invalid lines
   * On persistent failure, keeps in-memory queue and emits error event
   */
  private async loadFromFile(): Promise<{ fileFound: boolean; skippedLines: number; readError: boolean }> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
      try {
        const content = await fs.readFile(this.filePath, 'utf-8');
        const { items, skippedLines } = this.parseQueueFile(content);
        this.items = items;
        logger.debug({ filePath: this.filePath, itemCount: this.items.length }, 'Queue file loaded');
        this.handleFileRecovery();
        return { fileFound: true, skippedLines, readError: false };
      } catch (err) {
        const error = err as NodeJS.ErrnoException;

        if (error.code === 'ENOENT') {
          this.handleFileRecovery();
          // Create empty queue file for discoverability
          try {
            await fs.writeFile(this.filePath, '', { mode: 0o600 });
            logger.debug({ filePath: this.filePath }, 'Queue file created (empty)');
          } catch {
            // Silently ignore - may not have write permission
          }
          logger.debug({ filePath: this.filePath }, 'Queue file not found, initialized empty queue');
          return { fileFound: false, skippedLines: 0, readError: false };
        }

        lastError = error;
        logger.warn({ err: error, attempt: attempt + 1 }, 'Failed to read queue file, retrying');

        if (attempt < RETRY_COUNT) {
          await delay(RETRY_DELAY_MS);
        }
      }
    }

    // Don't throw - emit event and continue with in-memory queue
    if (!this.fileErrorState) {
      this.fileErrorState = true;
      this.emit('file_read_error');
    }
    logger.error(
      { err: lastError, filePath: this.filePath },
      'Queue file read failed, using in-memory queue'
    );
    return { fileFound: false, skippedLines: 0, readError: true };
  }

  /**
   * Save queue to file
   * On persistent failure, emits error event but doesn't throw
   */
  private async saveToFile(): Promise<boolean> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
      try {
        const content = this.serializeQueue();
        await fs.writeFile(this.filePath, content, { mode: 0o600 });
        logger.debug({ filePath: this.filePath }, 'Queue file saved');
        this.handleFileRecovery();
        return true;
      } catch (err) {
        const error = err as Error;
        lastError = error;
        logger.warn({ err: error, attempt: attempt + 1 }, 'Failed to write queue file, retrying');

        if (attempt < RETRY_COUNT) {
          await delay(RETRY_DELAY_MS);
        }
      }
    }

    // Don't throw - emit event and continue with in-memory queue
    if (!this.fileErrorState) {
      this.fileErrorState = true;
      this.emit('file_write_error');
    }
    logger.error(
      { err: lastError, filePath: this.filePath },
      'Queue file write failed, changes may be lost'
    );
    return false;
  }

  /**
   * Parse queue file content into QueueItem array
   * Format (@ prefix for directives, bare text for prompts):
   *   bare text             → regular prompt
   *   # comment             → skipped
   *   @new                  → new session (next line is the prompt)
   *   @save name            → label session
   *   @load name            → load session
   *   @pause [reason]       → breakpoint (pause auto-execution)
   *   @(  ... @)            → multiline prompt
   *   \@text                → escaped: prompt "@text"
   *   \\@text               → escaped: prompt "\@text"
   */
  private parseQueueFile(content: string): { items: QueueItem[]; skippedLines: number } {
    const lines = content.replace(/\r\n/g, '\n').split('\n');
    const items: QueueItem[] = [];
    let skippedLines = 0;

    // Multiline block state
    let inMultilineBlock = false;
    let multilineLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Check for multiline block end: @)
      if (inMultilineBlock) {
        if (trimmedLine === '@)') {
          const prompt = multilineLines.join('\n');
          items.push({
            prompt,
            isNewSession: false,
            isMultiline: true,
          });
          inMultilineBlock = false;
          multilineLines = [];
          continue;
        }
        // Inside multiline block - preserve original line (not trimmed), no directive parsing
        multilineLines.push(line);
        continue;
      }

      // Check for multiline block start: @(
      if (trimmedLine === '@(') {
        inMultilineBlock = true;
        multilineLines = [];
        continue;
      }

      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        skippedLines++;
        continue;
      }

      // Escape: \\@ → prompt "\@..."
      if (trimmedLine.startsWith('\\\\@')) {
        items.push({ prompt: trimmedLine.slice(1), isNewSession: false }); // Remove first backslash
        continue;
      }

      // Escape: \@ → prompt "@..."
      if (trimmedLine.startsWith('\\@')) {
        items.push({ prompt: trimmedLine.slice(1), isNewSession: false }); // Remove backslash
        continue;
      }

      // @ directive lines
      if (trimmedLine.startsWith('@')) {
        const rest = trimmedLine.slice(1);
        const spaceIdx = rest.indexOf(' ');
        const dirName = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).toLowerCase();
        const args = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();

        // Interactive-only commands → warning + treat as bare prompt
        if (INTERACTIVE_ONLY_DIRECTIVES.includes(dirName)) {
          logger.warn({ directive: dirName, line: i + 1 }, 'Interactive-only command used as @directive in queue file, treating as prompt');
          items.push({ prompt: trimmedLine, isNewSession: false });
          continue;
        }

        // Known queue directives
        if (KNOWN_QUEUE_DIRECTIVES.includes(dirName)) {
          switch (dirName) {
            case 'new':
              items.push({ prompt: '', isNewSession: true });
              continue;
            case 'pause':
              items.push({ prompt: args, isNewSession: false, isBreakpoint: true });
              continue;
            case 'save':
              if (args) {
                items.push({ prompt: '', isNewSession: false, labelSession: args });
              }
              continue;
            case 'load': {
              const label = args || '';
              if (label) {
                items.push({ prompt: '', isNewSession: true, loadSessionLabel: label });
              }
              continue;
            }
            case 'model':
              if (args) {
                items.push({ prompt: `/model ${args}`, isNewSession: false, modelName: args });
              }
              continue;
            case 'delay': {
              const ms = parseInt(args, 10);
              if (ms > 0) {
                items.push({ prompt: '', isNewSession: false, delayMs: ms });
              }
              continue;
            }
          }
        }

        // Unknown @directive → warning + treat as bare prompt
        logger.warn({ directive: dirName, line: i + 1 }, 'Unknown @directive in queue file, treating as prompt');
        items.push({ prompt: trimmedLine, isNewSession: false });
        continue;
      }

      // Default: bare text → regular prompt
      items.push({ prompt: trimmedLine, isNewSession: false });
    }

    // Handle unclosed multiline block
    if (inMultilineBlock && multilineLines.length > 0) {
      logger.warn('Unclosed multiline block in queue file');
      items.push({
        prompt: multilineLines.join('\n'),
        isNewSession: false,
        isMultiline: true,
      });
    }

    return { items, skippedLines };
  }

  /**
   * Serialize queue items to file format (@ directives)
   */
  private serializeQueue(): string {
    return this.items
      .map((item) => {
        // Label/save session directive
        if (item.labelSession) {
          return `@save ${item.labelSession}`;
        }
        // Load session directive (deferred lookup)
        if (item.loadSessionLabel) {
          return `@load ${item.loadSessionLabel}`;
        }
        // Resume session (already resolved session ID)
        if (item.resumeSessionId) {
          return '@new';
        }
        // Pause directive (breakpoint)
        if (item.isBreakpoint) {
          return item.prompt ? `@pause ${item.prompt}` : '@pause';
        }
        // Model switch directive
        if (item.modelName) {
          return `@model ${item.modelName}`;
        }
        // Delay directive
        if (item.delayMs) {
          return `@delay ${item.delayMs}`;
        }
        // Multiline prompt (if also new session, output @new before @( block)
        if (item.isMultiline) {
          const prefix = item.isNewSession ? '@new\n' : '';
          return `${prefix}@(\n${item.prompt}\n@)`;
        }
        // New session directive
        if (item.isNewSession) {
          return '@new';
        }
        // Regular prompt - escape if starts with @
        if (item.prompt.startsWith('\\@')) {
          return `\\${item.prompt}`; // \@ → \\@
        }
        if (item.prompt.startsWith('@')) {
          return `\\${item.prompt}`; // @ → \@
        }
        return item.prompt;
      })
      .join('\n');
  }

  /**
   * Emit a queue event
   */
  private emitEvent(type: QueueEvent['type'], item?: QueueItem): void {
    const event: QueueEvent = {
      type,
      item,
      queueLength: this.items.length,
      timestamp: new Date(),
    };
    this.emit(type as keyof QueueManagerEvents, event);
  }

  /**
   * Add item to the end of the queue
   * @param prompt The prompt text (can be empty for Label/Load commands)
   * @param optionsOrIsNewSession Either AddItemOptions object or boolean for backward compatibility
   */
  async addItem(prompt: string, optionsOrIsNewSession: AddItemOptions | boolean = false): Promise<void> {
    return this.runExclusive(async () => {
      await this.loadFromFile();

      // Handle backward compatibility: addItem(prompt, true) still works
      const options: AddItemOptions = typeof optionsOrIsNewSession === 'boolean'
        ? { isNewSession: optionsOrIsNewSession }
        : optionsOrIsNewSession;

      const modelName = options.modelName?.trim() || undefined;
      const delayMs = options.delayMs && options.delayMs > 0 ? options.delayMs : undefined;
      const item: QueueItem = {
        prompt,
        isNewSession: options.isNewSession ?? false,
        isBreakpoint: options.isBreakpoint,
        labelSession: options.labelSession,
        resumeSessionId: options.resumeSessionId,
        loadSessionLabel: options.loadSessionLabel,
        isMultiline: options.isMultiline,
        modelName,
        delayMs,
        addedAt: new Date(),
      };

      this.items.push(item);
      await this.saveToFile();

      logger.info({
        prompt: prompt.substring(0, 50),
        isNewSession: item.isNewSession,
        isBreakpoint: item.isBreakpoint,
        labelSession: item.labelSession,
        resumeSessionId: item.resumeSessionId ? '***' : undefined,
        isMultiline: item.isMultiline,
      }, 'Item added to queue');
      this.emitEvent('item_added', item);
    });
  }

  /**
   * Add item to the FRONT of the queue (for retry on failure)
   * Used when a task fails and needs to be retried
   */
  async prependItem(prompt: string, options: AddItemOptions = {}): Promise<void> {
    return this.runExclusive(async () => {
      await this.loadFromFile();

      const modelName = options.modelName?.trim() || undefined;
      const delayMs = options.delayMs && options.delayMs > 0 ? options.delayMs : undefined;
      const item: QueueItem = {
        prompt,
        isNewSession: options.isNewSession ?? false,
        isBreakpoint: options.isBreakpoint,
        labelSession: options.labelSession,
        resumeSessionId: options.resumeSessionId,
        loadSessionLabel: options.loadSessionLabel,
        isMultiline: options.isMultiline,
        modelName,
        delayMs,
        addedAt: new Date(),
      };

      this.items.unshift(item);
      await this.saveToFile();

      logger.info({
        prompt: prompt.substring(0, 50),
        isNewSession: item.isNewSession,
      }, 'Item prepended to queue front');
      this.emitEvent('item_added', item);
    });
  }

  /**
   * Remove and return the last item from the queue
   */
  async removeLastItem(): Promise<QueueItem | null> {
    return this.runExclusive(async () => {
      await this.loadFromFile();

      if (this.items.length === 0) {
        return null;
      }

      const item = this.items.pop()!;
      await this.saveToFile();

      logger.info({ prompt: item.prompt.substring(0, 50) }, 'Last item removed from queue');
      this.emitEvent('item_removed', item);

      return item;
    });
  }

  /**
   * Get all items in the queue (in-memory)
   */
  getItems(): QueueItem[] {
    return [...this.items];
  }

  /**
   * Get the next item in the queue without removing it (in-memory)
   */
  getNextItem(): QueueItem | null {
    return this.items.length > 0 ? this.items[0] : null;
  }

  /**
   * Pop and return the next (first) item from the queue
   */
  async popNextItem(): Promise<QueueItem | null> {
    return this.runExclusive(async () => {
      await this.loadFromFile();

      if (this.items.length === 0) {
        return null;
      }

      const item = this.items.shift()!;
      await this.saveToFile();

      logger.info({ prompt: item.prompt.substring(0, 50) }, 'Next item popped from queue');
      this.emitEvent('item_executed', item);

      return item;
    });
  }

  /**
   * Get the number of items in the queue (in-memory)
   */
  getLength(): number {
    return this.items.length;
  }

  /**
   * Reload queue from file and return reload result
   */
  async reload(): Promise<ReloadResult> {
    return this.runExclusive(async () => {
      const loadResult = await this.loadFromFile();

      const result: ReloadResult = {
        success: true,
        fileFound: loadResult.fileFound,
        itemCount: this.items.length,
        skippedLines: loadResult.skippedLines,
      };

      logger.info({ ...result }, 'Queue reloaded');
      this.emitEvent('queue_reloaded');

      return result;
    });
  }
}
