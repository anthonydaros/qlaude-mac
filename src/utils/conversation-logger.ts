/**
 * ConversationLogger - Logs Q&A conversations from Claude Code sessions
 *
 * Extracts clean conversation data from Claude Code's JSONL session files.
 * Session ID is provided by Claude Code's SessionStart hook.
 */

import { appendFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname, join } from 'path';
import type { ConversationLogConfig } from '../types/config.js';
import type { QueueItem } from '../types/queue.js';
import { logger } from './logger.js';
import {
  getSessionFilePath,
  extractConversations,
  formatConversationsForLog,
} from './session-log-extractor.js';
import { readSessionId, deleteSessionId } from './hook-setup.js';
import { getSessionLogOffset, saveSessionLogOffset } from './session-log-offsets.js';

/**
 * Format timestamp for log entry
 */
function formatTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

export class ConversationLogger {
  private config: ConversationLogConfig;
  private filePath: string;
  private cwd: string;
  private currentSessionId: string | null = null;
  private lastExtractedMessageCount: number = 0;
  private currentQueueLogPath: string | null = null;
  private queueLogsDir: string;

  constructor(config: ConversationLogConfig) {
    this.config = config;
    this.filePath = resolve(process.cwd(), config.filePath);
    this.cwd = process.cwd();
    // Queue logs directory next to the main log file
    this.queueLogsDir = join(dirname(this.filePath), 'queue-logs');

    // Try to read session ID from hook at startup
    this.currentSessionId = readSessionId(this.cwd);
    logger.debug({ cwd: this.cwd, sessionId: this.currentSessionId }, 'ConversationLogger session ID loaded');

    if (config.enabled) {
      this.initLogFile();
      logger.info({ filePath: this.filePath }, 'ConversationLogger initialized');
    }
  }

  /**
   * Initialize log file with header if it doesn't exist
   */
  private initLogFile(): void {
    if (!existsSync(this.filePath)) {
      const header = `# Qlaude Conversation Log\n# Started: ${new Date().toISOString()}\n${'='.repeat(90)}\n\n`;
      try {
        const dir = dirname(this.filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(this.filePath, header, 'utf-8');
      } catch (err) {
        logger.error({ err, filePath: this.filePath }, 'Failed to create conversation log file');
      }
    }
  }

  /**
   * Check if logging is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Log queue execution started
   * Reads session ID from hook-provided file
   * Creates a new queue-specific log file
   */
  logQueueStarted(): void {
    if (!this.config.enabled) return;

    // Reset state for new queue execution
    this.lastExtractedMessageCount = 0;

    // Try to read session ID from hook
    this.currentSessionId = readSessionId(this.cwd);

    // Create queue logs directory if needed
    if (!existsSync(this.queueLogsDir)) {
      try {
        mkdirSync(this.queueLogsDir, { recursive: true });
      } catch (err) {
        logger.error({ err, dir: this.queueLogsDir }, 'Failed to create queue logs directory');
      }
    }

    // Create new queue-specific log file with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.currentQueueLogPath = join(this.queueLogsDir, `queue-${timestamp}.log`);

    const sessionId = this.currentSessionId;
    const sessionInfo = sessionId ? ` (${sessionId})` : '';
    const entry = `\n${'═'.repeat(90)}\n[${formatTimestamp(new Date())}] Queue execution started${sessionInfo}\n${'═'.repeat(90)}\n\n`;

    try {
      // Write to queue-specific log file
      writeFileSync(this.currentQueueLogPath, entry, 'utf-8');
      logger.debug({ sessionId: this.currentSessionId, queueLog: this.currentQueueLogPath }, 'ConversationLogger: queue started logged');
    } catch (err) {
      logger.error({ err }, 'Failed to log queue started');
    }
  }

  /**
   * Log a queue item execution
   */
  logQueueItem(item: QueueItem): void {
    if (!this.config.enabled || !this.currentQueueLogPath) return;

    let itemDesc: string;
    if (item.isBreakpoint) {
      itemDesc = item.prompt ? `>># ${item.prompt}` : '>>#';
    } else if (item.labelSession) {
      itemDesc = `>>{Label:${item.labelSession}}`;
    } else if (item.loadSessionLabel) {
      itemDesc = item.prompt
        ? `>>>{Load:${item.loadSessionLabel}} ${item.prompt}`
        : `>>>{Load:${item.loadSessionLabel}}`;
    } else if (item.isMultiline) {
      const prefix = item.isNewSession ? '>>>(' : '>>(';
      itemDesc = `${prefix}...>>)`;
    } else if (item.isNewSession) {
      itemDesc = item.prompt ? `>>> ${item.prompt}` : '>>>';
    } else {
      itemDesc = `>> ${item.prompt}`;
    }

    const entry = `[${formatTimestamp(new Date())}] Queue: ${itemDesc}\n`;

    // For multiline, also log the full prompt on separate lines
    let fullEntry = entry;
    if (item.isMultiline && item.prompt) {
      fullEntry += `${item.prompt}\n${'─'.repeat(40)}\n`;
    }

    try {
      appendFileSync(this.currentQueueLogPath, fullEntry, 'utf-8');
      logger.debug({ item: itemDesc }, 'ConversationLogger: queue item logged');
    } catch (err) {
      logger.error({ err }, 'Failed to log queue item');
    }
  }

  /**
   * Log new session starting (extract current session first)
   * @param item Optional queue item to show what session is being loaded
   */
  logNewSessionStarting(item?: QueueItem): void {
    if (!this.config.enabled || !this.currentQueueLogPath) return;

    // Extract and log current session's conversations before switching
    this.extractAndLogCurrentSession();

    // Build session info: show label and session ID being loaded
    let sessionInfo = '';
    if (item?.loadSessionLabel && item?.resumeSessionId) {
      sessionInfo = ` → Loading "${item.loadSessionLabel}" (${item.resumeSessionId.slice(0, 8)}...)`;
    } else if (item?.loadSessionLabel) {
      sessionInfo = ` → Loading "${item.loadSessionLabel}"`;
    } else if (item?.resumeSessionId) {
      sessionInfo = ` → Resuming ${item.resumeSessionId.slice(0, 8)}...`;
    }
    const entry = `\n${'─'.repeat(90)}\n[${formatTimestamp(new Date())}] New session starting${sessionInfo}\n${'─'.repeat(90)}\n\n`;

    try {
      appendFileSync(this.currentQueueLogPath, entry, 'utf-8');
      logger.debug('ConversationLogger: new session logged');
    } catch (err) {
      logger.error({ err }, 'Failed to log new session');
    }

    // Reset for new session
    this.currentSessionId = null;
    this.lastExtractedMessageCount = 0;
  }

  /**
   * Log queue execution completed (extract final session)
   */
  logQueueCompleted(): void {
    if (!this.config.enabled || !this.currentQueueLogPath) return;

    // Refresh session ID in case it was updated
    this.refreshSessionId();

    // Extract and log current session's conversations
    this.extractAndLogCurrentSession();

    const entry = `\n${'═'.repeat(90)}\n[${formatTimestamp(new Date())}] Queue execution completed\n${'═'.repeat(90)}\n\n`;

    try {
      appendFileSync(this.currentQueueLogPath, entry, 'utf-8');
      logger.debug({ queueLog: this.currentQueueLogPath }, 'ConversationLogger: queue completed logged');
    } catch (err) {
      logger.error({ err }, 'Failed to log queue completed');
    }

    // Clear queue log path (queue execution finished)
    this.currentQueueLogPath = null;

    // Clean up session ID file
    try {
      deleteSessionId(this.cwd);
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Extract conversations from current session and append to queue log
   */
  private extractAndLogCurrentSession(): void {
    if (!this.currentQueueLogPath) return;

    // Try to get session ID from hook if not already set
    if (!this.currentSessionId) {
      this.refreshSessionId();
    }

    if (!this.currentSessionId) {
      logger.warn('No session ID available, skipping extraction');
      return;
    }

    logger.debug(
      { currentSessionId: this.currentSessionId, lastCount: this.lastExtractedMessageCount },
      'extractAndLogCurrentSession called'
    );

    const sessionPath = getSessionFilePath(this.cwd, this.currentSessionId);
    if (!sessionPath) {
      logger.warn({ sessionId: this.currentSessionId }, 'Session file not found');
      return;
    }

    try {
      const conversations = extractConversations(sessionPath);
      logger.debug(
        { total: conversations.length, lastCount: this.lastExtractedMessageCount, sessionId: this.currentSessionId },
        'Conversations extracted from JSONL'
      );

      // Only log new conversations (skip already extracted ones)
      const newConversations = conversations.slice(this.lastExtractedMessageCount);

      if (newConversations.length === 0) {
        logger.debug('No new conversations to extract');
        this.lastExtractedMessageCount = conversations.length;
        return;
      }

      const formatted = formatConversationsForLog(newConversations, this.config.timestamps);

      if (formatted) {
        appendFileSync(this.currentQueueLogPath, formatted, 'utf-8');
        logger.info(
          { count: newConversations.length, sessionId: this.currentSessionId },
          'Conversations extracted and logged'
        );
      }

      // Update extracted count (both in-memory and persistent)
      this.lastExtractedMessageCount = conversations.length;
      saveSessionLogOffset(this.currentSessionId, conversations.length);
    } catch (err) {
      logger.error({ err, sessionId: this.currentSessionId }, 'Failed to extract conversations');
    }
  }

  /**
   * Refresh session ID from hook-provided file
   * Call this when session might have changed
   */
  refreshSessionId(): void {
    const sessionId = readSessionId(this.cwd);
    if (sessionId && sessionId !== this.currentSessionId) {
      logger.info({ oldId: this.currentSessionId, newId: sessionId }, 'Session ID updated from hook');
      this.currentSessionId = sessionId;
      // Load persistent offset to prevent duplicate logging on session resume
      this.lastExtractedMessageCount = getSessionLogOffset(sessionId);
      logger.debug({ sessionId, offset: this.lastExtractedMessageCount }, 'Loaded persistent log offset');
    }
  }

  /**
   * Set session ID directly (for testing or manual override)
   */
  setSessionId(sessionId: string): void {
    if (!this.config.enabled) return;
    this.currentSessionId = sessionId;
    this.lastExtractedMessageCount = 0;
    logger.debug({ sessionId }, 'Session ID set manually');
  }

  /**
   * Get the cumulative log file path (legacy)
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Get the current queue-specific log file path
   * Returns null if no queue is currently being executed
   */
  getCurrentQueueLogPath(): string | null {
    return this.currentQueueLogPath;
  }

  /**
   * Get the latest queue log file path
   * Returns current queue log if executing, otherwise finds most recent log file
   */
  getLatestQueueLogPath(): string | null {
    // If currently executing a queue, return that path
    if (this.currentQueueLogPath && existsSync(this.currentQueueLogPath)) {
      return this.currentQueueLogPath;
    }
    // Otherwise find most recent queue log in directory
    if (!existsSync(this.queueLogsDir)) return null;
    const files = readdirSync(this.queueLogsDir)
      .filter(f => f.startsWith('queue-') && f.endsWith('.log'))
      .sort()
      .reverse();
    return files.length > 0 ? join(this.queueLogsDir, files[0]) : null;
  }

  /**
   * Get the current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  // Legacy methods (no-op, kept for compatibility)
  snapshotSessionIds(): void {
    // No longer needed with hook-based approach
  }

  detectNewSession(): void {
    // Use refreshSessionId() instead
    this.refreshSessionId();
  }

  trackExecutedPrompt(_prompt: string): void {
    // No longer needed with hook-based approach
  }

  startCapture(_prompt: string): void {
    // No-op: JSONL extraction doesn't need real-time capture
  }

  appendData(_data: string): void {
    // No-op: JSONL extraction doesn't need PTY data
  }

  endCapture(): void {
    // No-op: JSONL extraction doesn't need capture end
  }

  cancelCapture(): void {
    // No-op: JSONL extraction doesn't need capture cancel
  }
}
