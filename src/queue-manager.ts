import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import { logger } from './utils/logger.js';
import type { QueueItem, QueueEvent, QueueManagerEvents, ReloadResult, AddItemOptions } from './types/queue.js';

// Queue file prefixes
const NEW_SESSION_PREFIX = '>>> ';
const BREAKPOINT_PREFIX = '>>#';
const LABEL_PATTERN = /^>>\{Label:([^}]+)\}$/i;
const LOAD_PATTERN = /^>>\{Load:([^}]+)\}$/i;
const NEW_SESSION_LOAD_PATTERN = /^>>>\{Load:([^}]+)\}(.*)$/i;  // Shorthand: >>> + >>{Load:name} + optional prompt

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
 * Each line in the queue file represents a single prompt
 * Lines prefixed with '>>> ' are new session markers
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
   * Also tracks invalid lines (empty or whitespace-only)
   * Supports multiline blocks: >>( ... >>) and >>>( ... >>)
   */
  private parseQueueFile(content: string): { items: QueueItem[]; skippedLines: number } {
    const lines = content.split('\n');
    const items: QueueItem[] = [];
    let skippedLines = 0;

    // Multiline block state
    let inMultilineBlock = false;
    let multilineIsNewSession = false;
    let multilineLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();

      // Check for multiline block end: >>) or >>>)
      if (inMultilineBlock) {
        if (trimmedLine === '>>)' || trimmedLine === '>>>)') {
          // End of multiline block
          const prompt = multilineLines.join('\n');
          items.push({
            prompt,
            isNewSession: multilineIsNewSession,
            isMultiline: true,
          });
          inMultilineBlock = false;
          multilineLines = [];
          continue;
        }
        // Inside multiline block - preserve original line (not trimmed)
        multilineLines.push(line);
        continue;
      }

      // Check for multiline block start: >>>( or >>(
      if (trimmedLine === '>>>(' || trimmedLine === '>>(') {
        inMultilineBlock = true;
        multilineIsNewSession = trimmedLine === '>>>(';
        multilineLines = [];
        continue;
      }

      if (!trimmedLine || trimmedLine.startsWith('#')) {
        skippedLines++;
        continue;
      }

      // Check for Label command: >>{Label:name}
      const labelMatch = trimmedLine.match(LABEL_PATTERN);
      if (labelMatch) {
        items.push({
          prompt: '',
          isNewSession: false,
          labelSession: labelMatch[1].trim(),
        });
        continue;
      }

      // Check for New Session + Load shorthand: >>>{Load:name} or >>>{Load:name} prompt
      const newSessionLoadMatch = trimmedLine.match(NEW_SESSION_LOAD_PATTERN);
      if (newSessionLoadMatch) {
        const label = newSessionLoadMatch[1].trim();
        const prompt = newSessionLoadMatch[2]?.trim() || '';
        items.push({
          prompt,
          isNewSession: true,
          loadSessionLabel: label,  // Deferred lookup at execution time
        });
        continue;
      }

      // Check for Load command: >>{Load:name}
      const loadMatch = trimmedLine.match(LOAD_PATTERN);
      if (loadMatch) {
        const label = loadMatch[1].trim();
        items.push({
          prompt: '',
          isNewSession: true,
          loadSessionLabel: label,  // Deferred lookup at execution time
        });
        continue;
      }

      // Check for Breakpoint command: >>#
      if (trimmedLine.startsWith(BREAKPOINT_PREFIX)) {
        const comment = trimmedLine.slice(BREAKPOINT_PREFIX.length).trim();
        items.push({
          prompt: comment,
          isNewSession: false,
          isBreakpoint: true,
        });
        continue;
      }

      // Check for New Session command: >>> or >>> prompt
      if (trimmedLine === '>>>' || trimmedLine.startsWith(NEW_SESSION_PREFIX)) {
        const prompt = trimmedLine === '>>>' ? '' : trimmedLine.slice(NEW_SESSION_PREFIX.length);
        items.push({
          prompt,
          isNewSession: true,
        });
        continue;
      }

      // Default: regular prompt
      items.push({
        prompt: trimmedLine,
        isNewSession: false,
      });
    }

    // Handle unclosed multiline block (treat remaining lines as content)
    if (inMultilineBlock && multilineLines.length > 0) {
      logger.warn('Unclosed multiline block in queue file');
      items.push({
        prompt: multilineLines.join('\n'),
        isNewSession: multilineIsNewSession,
        isMultiline: true,
      });
    }

    return { items, skippedLines };
  }

  /**
   * Serialize queue items to file format
   */
  private serializeQueue(): string {
    return this.items
      .map((item) => {
        // Label session command
        if (item.labelSession) {
          return `>>{Label:${item.labelSession}}`;
        }
        // Load session command (deferred lookup)
        if (item.loadSessionLabel) {
          const base = `>>>{Load:${item.loadSessionLabel}}`;
          return item.prompt ? `${base} ${item.prompt}` : base;
        }
        // Resume session command (already resolved session ID)
        if (item.resumeSessionId) {
          return `${NEW_SESSION_PREFIX}${item.prompt}`;
        }
        // Breakpoint command
        if (item.isBreakpoint) {
          return item.prompt ? `${BREAKPOINT_PREFIX} ${item.prompt}` : BREAKPOINT_PREFIX;
        }
        // Multiline prompt
        if (item.isMultiline) {
          const prefix = item.isNewSession ? '>>>(' : '>>(';
          return `${prefix}\n${item.prompt}\n>>)`;
        }
        // New session command
        if (item.isNewSession) {
          return `${NEW_SESSION_PREFIX}${item.prompt}`;
        }
        // Regular prompt
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

      const item: QueueItem = {
        prompt,
        isNewSession: options.isNewSession ?? false,
        isBreakpoint: options.isBreakpoint,
        labelSession: options.labelSession,
        resumeSessionId: options.resumeSessionId,
        loadSessionLabel: options.loadSessionLabel,
        isMultiline: options.isMultiline,
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

      const item: QueueItem = {
        prompt,
        isNewSession: options.isNewSession ?? false,
        isBreakpoint: options.isBreakpoint,
        labelSession: options.labelSession,
        resumeSessionId: options.resumeSessionId,
        loadSessionLabel: options.loadSessionLabel,
        isMultiline: options.isMultiline,
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
