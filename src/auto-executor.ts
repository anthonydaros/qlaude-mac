/**
 * AutoExecutor - Automatic queue execution engine
 * Listens for READY state and executes queue items automatically
 */

import { EventEmitter } from 'events';
import type { StateDetector } from './state-detector.js';
import type { QueueManager } from './queue-manager.js';
import type { PtyWrapper } from './pty-wrapper.js';
import type { Display } from './display.js';
import type { AutoExecutorEvents, AutoExecutorConfig } from './types/auto-executor.js';
import { NEW_SESSION_MESSAGES } from './types/auto-executor.js';
import type { QueueItem } from './types/queue.js';
import type { AddItemOptions } from './types/queue.js';
import type { ClaudeCodeState, StateType } from './types/state.js';
import { logger } from './utils/logger.js';
import { saveSessionLabel, getSessionLabel } from './utils/session-labels.js';
import type { ConversationLogger } from './utils/conversation-logger.js';
import type { TelegramNotifier } from './utils/telegram.js';

/**
 * Dependencies required by AutoExecutor
 */
export interface AutoExecutorDependencies {
  stateDetector: StateDetector;
  queueManager: QueueManager;
  ptyWrapper: PtyWrapper;
  display: Display;
  getClaudeArgs: () => string[];
  conversationLogger?: ConversationLogger;
  terminalEmulator?: { clear: () => void };
  telegramNotifier?: TelegramNotifier;
}

/**
 * AutoExecutor automatically executes queue items when Claude Code is ready
 *
 * Flow:
 * 1. StateDetector emits 'state_change' with READY state
 * 2. AutoExecutor checks if enabled and PTY is running
 * 3. Pops next item from queue (FIFO)
 * 4. Shows notification via Display
 * 5. Writes prompt to PTY
 * 6. Emits 'executed' event
 */
export class AutoExecutor extends EventEmitter {
  private static readonly MAX_RESTART_RETRIES = 1;
  private static readonly RESTART_RETRY_DELAY_MS = 1000;

  private deps: AutoExecutorDependencies;
  private enabled: boolean;
  private pendingNewSessionItem: QueueItem | null = null;
  private currentExecutingItem: QueueItem | null = null;
  private restartRetryCount = 0;
  private queueExecutionActive = false;
  private executeInProgress = false;
  private pendingExecuteRequest = false;

  emit<K extends keyof AutoExecutorEvents>(
    event: K,
    ...args: Parameters<AutoExecutorEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof AutoExecutorEvents>(
    event: K,
    listener: AutoExecutorEvents[K]
  ): this {
    return super.on(event, listener);
  }

  constructor(deps: AutoExecutorDependencies, config: AutoExecutorConfig = {}) {
    super();
    this.deps = deps;
    this.enabled = config.enabled ?? true;
    this.setupEventListeners();
  }

  /**
   * Set up event listeners for state changes
   */
  private setupEventListeners(): void {
    this.deps.stateDetector.on('state_change', (state: ClaudeCodeState) => {
      if (state.type === 'READY' && this.enabled) {
        // Check for spinner - if present, pause and notify instead of auto-executing
        if (state.metadata?.hasSpinner) {
          this.handleSpinnerDetected();
          return;
        }
        this.executeNext();
      } else if (state.type === 'TASK_FAILED' && this.enabled) {
        // Task failed with explicit QUEUE_STOP marker or rate limit
        void this.handleTaskFailed(state.metadata?.failureReason);
      } else if (this.isBlockingState(state.type) && this.enabled) {
        this.showPausedMessage(state.type);
      }
    });
  }

  /**
   * Handle spinner detected during READY state
   * Pause auto-execution and notify user as safety measure
   */
  private handleSpinnerDetected(): void {
    const queueLength = this.deps.queueManager.getLength();
    if (queueLength === 0) return;

    this.deps.display.showMessage('warning', '[Queue] Spinner detected - pausing for safety. Use :resume to continue.');
    this.emit('spinner_detected');
    logger.info({ queueLength }, 'Auto-execution paused due to spinner detection');
  }

  /**
   * Handle task failure with explicit QUEUE_STOP marker or rate limit
   * Re-adds the failed item to queue front for retry, then stops auto-execution
   */
  private async handleTaskFailed(reason?: string): Promise<void> {
    // Re-add current executing item to front of queue for retry
    if (this.currentExecutingItem) {
      try {
        await this.deps.queueManager.prependItem(
          this.currentExecutingItem.prompt,
          this.toAddItemOptions(this.currentExecutingItem)
        );
        logger.info(
          { prompt: this.currentExecutingItem.prompt.substring(0, 50) },
          'Failed item re-added to queue front for retry'
        );
      } catch (err) {
        logger.error({ err }, 'Failed to re-add item to queue');
      }
      this.currentExecutingItem = null;
    }

    const queueLength = this.deps.queueManager.getLength();

    // Stop auto-execution
    this.stop();
    this.deps.display.setPaused(true);

    // Format message
    const reasonText = reason ? `: ${reason}` : '';
    const itemText = queueLength === 1 ? '1 item' : `${queueLength} items`;
    this.deps.display.showMessage('error', `[Queue] Task failed${reasonText}. Auto-execution stopped (${itemText} remaining).`);

    // Emit event for external handlers
    this.emit('task_failed', reason);

    // Send Telegram notification
    this.deps.telegramNotifier?.notify('task_failed', {
      queueLength,
      message: reason,
    });

    // Reset terminal emulator to fix cursor position for :resume detection
    this.deps.terminalEmulator?.clear();

    logger.warn({ reason, queueLength }, 'Queue execution stopped due to task failure (QUEUE_STOP or rate limit)');
  }

  /**
   * Check if a state type is a blocking state (safety guard)
   * Note: INTERRUPTED removed - high false positive rate from code content matching patterns
   */
  private isBlockingState(stateType: StateType): boolean {
    return ['SELECTION_PROMPT', 'TASK_FAILED'].includes(stateType);
  }

  /**
   * Show paused message when blocking state is detected
   */
  private showPausedMessage(stateType: StateType): void {
    const queueLength = this.deps.queueManager.getLength();
    if (queueLength === 0) return;

    const itemText = queueLength === 1 ? '1 item' : `${queueLength} items`;
    this.deps.display.showMessage('warning', `[Queue] Paused (${itemText}) - waiting for user input`);
    this.emit('paused', stateType);
    logger.info({ stateType, queueLength }, 'Auto-execution paused due to blocking state');
    // Note: Telegram notifications for blocking states are sent from main.ts state_change handler
  }

  /**
   * Execute the next item in the queue
   */
  private async executeNext(): Promise<void> {
    if (this.executeInProgress) {
      this.pendingExecuteRequest = true;
      logger.debug('executeNext already in progress, queueing follow-up READY trigger');
      return;
    }
    this.executeInProgress = true;

    try {
      // Check PTY status before execution
      if (!this.deps.ptyWrapper.isRunning()) {
        logger.warn('PTY not running, skipping queue execution');
        return;
      }

      // Check for pending new session item first (AC 3)
      if (this.pendingNewSessionItem) {
        const item = this.pendingNewSessionItem;
        this.pendingNewSessionItem = null;
        const truncated = this.truncatePrompt(item.prompt);
        this.deps.display.showMessage('info', `[Queue] Executing: "${truncated}"`);
        this.deps.ptyWrapper.write(item.prompt);
        await new Promise((resolve) => setTimeout(resolve, 50));
        this.deps.ptyWrapper.write('\r');
        this.emit('executed', item);
        this.currentExecutingItem = null;
        logger.info({ prompt: item.prompt.substring(0, 50) }, 'Pending new session item executed');
        return;
      }

      try {
        const item = await this.deps.queueManager.popNextItem();

      if (!item) {
        // Queue is empty - auto-execution idle (AC 6)
        logger.debug({ queueExecutionActive: this.queueExecutionActive }, 'Queue empty, checking queue_completed condition');
        if (this.queueExecutionActive) {
          this.queueExecutionActive = false;
          this.emit('queue_completed');
          // Send Telegram notification for queue completion
          this.deps.telegramNotifier?.notify('queue_completed');
          logger.info('Queue execution completed (queue_completed event emitted)');
        }
        logger.debug('Queue empty, auto-execution idle');
        return;
      }

      // Track current executing item for recovery on failure (rate limit, QUEUE_STOP)
      this.currentExecutingItem = item;

      // Emit queue_started on first item
      logger.debug({ queueExecutionActive: this.queueExecutionActive }, 'Checking queue_started condition');
      if (!this.queueExecutionActive) {
        this.queueExecutionActive = true;
        this.emit('queue_started');
        // Send Telegram notification for queue start
        this.deps.telegramNotifier?.notify('queue_started', {
          queueLength: this.deps.queueManager.getLength() + 1, // +1 because we just popped the current item
        });
        logger.info('Queue execution started (queue_started event emitted)');
      }

      // Log queue item to conversation log
      this.deps.conversationLogger?.logQueueItem(item);

      // Handle breakpoint - pause auto-execution
      if (item.isBreakpoint) {
        if (item.prompt) {
          this.deps.display.showMessage('info', `[Queue] Breakpoint: "${item.prompt}"`);
        } else {
          this.deps.display.showMessage('info', '[Queue] Breakpoint reached');
        }
        this.stop();
        this.deps.display.setPaused(true);
        this.deps.display.showMessage('warning', '[Queue] Auto-execution paused. Use :resume to continue.');

        // Reset terminal emulator to fix cursor position for :resume detection
        this.deps.terminalEmulator?.clear();

        // Send Telegram notification for breakpoint
        this.deps.telegramNotifier?.notify('breakpoint', {
          queueLength: this.deps.queueManager.getLength(),
          message: item.prompt,
        });

        logger.info({ comment: item.prompt }, 'Breakpoint reached, auto-execution paused');
        return;
      }

      // Handle session label - save current session ID with label
      // Refresh session ID first in case it was cleared by new session or updated by hook
      if (item.labelSession) {
        this.deps.conversationLogger?.refreshSessionId();
        const sessionId = this.deps.conversationLogger?.getCurrentSessionId() ?? null;
        if (sessionId) {
          const wasOverwritten = saveSessionLabel(item.labelSession, sessionId);
          if (wasOverwritten) {
            this.deps.display.showMessage('warning', `[Queue] Label "${item.labelSession}" overwritten`);
          }
          this.deps.display.showMessage('success', `[Queue] Session labeled: "${item.labelSession}"`);
          logger.info({ label: item.labelSession, sessionId, wasOverwritten }, 'Session labeled');
        } else {
          logger.warn({ label: item.labelSession }, 'No session ID available for labeling');
          await this.handleTaskFailed('No active session to label');
          return;
        }
        // Reset state detector to trigger new READY detection cycle
        // (non-PTY items don't generate output, so we need to manually restart the cycle)
        this.deps.stateDetector.reset();
        return;
      }

      // Handle deferred session load - resolve label to session ID at execution time
      if (item.loadSessionLabel) {
        const sessionId = getSessionLabel(item.loadSessionLabel);
        if (sessionId) {
          item.resumeSessionId = sessionId;
          this.deps.display.showMessage('info', `[Queue] Loading session: "${item.loadSessionLabel}"`);
          logger.info({ label: item.loadSessionLabel, sessionId }, 'Session label resolved');
        } else {
          logger.warn({ label: item.loadSessionLabel }, 'Session label not found at execution time');
          await this.handleTaskFailed(`Session not found: "${item.loadSessionLabel}"`);
          return;
        }
      }

      // Handle new session flag (including resume)
      if (item.isNewSession || item.resumeSessionId) {
        await this.handleNewSession(item);
        return;
      }

      // Show notification before execution (AC 3)
      const truncated = this.truncatePrompt(item.prompt);
      this.deps.display.showMessage('info', `[Queue] Executing: "${truncated}"`);

      // Execute prompt (AC 1, 2)
      // Send text first, then Enter separately (Claude Code handles them differently)
      this.deps.ptyWrapper.write(item.prompt);
      await new Promise((resolve) => setTimeout(resolve, 50));
      this.deps.ptyWrapper.write('\r');

      // Emit executed event and clear tracking (successful execution)
      this.emit('executed', item);
      this.currentExecutingItem = null;
      logger.info({ prompt: item.prompt.substring(0, 50) }, 'Queue item executed');
      } catch (error) {
        // Handle queue file I/O errors gracefully
        logger.error({ error }, 'Failed to execute queue item');
        // System remains stable - will retry on next READY state
      }
    } finally {
      this.executeInProgress = false;
      if (this.pendingExecuteRequest) {
        this.pendingExecuteRequest = false;
        void this.executeNext();
      }
    }
  }

  /**
   * Handle new session item - restart PTY and queue prompt for execution after ready
   * Supports --resume for loading saved sessions
   */
  private async handleNewSession(item: QueueItem): Promise<void> {
    // Display message for user
    if (item.resumeSessionId) {
      this.deps.display.showMessage('info', '[Queue] Loading saved session...');
    } else {
      this.deps.display.showMessage('info', NEW_SESSION_MESSAGES.STARTING);
    }

    try {
      // Build args with --resume if resuming a session
      let args = this.deps.getClaudeArgs();
      if (item.resumeSessionId) {
        args = ['--resume', item.resumeSessionId, ...args];
        logger.info({ sessionId: item.resumeSessionId }, 'Resuming session with --resume');
      }

      await this.deps.ptyWrapper.restart(args);

      // Reset retry count on success
      this.restartRetryCount = 0;

      // Wait for READY state before executing prompt
      // StateDetector will emit 'state_change' when Claude Code is ready
      // Only set pending item if there's a prompt to execute
      if (item.prompt) {
        this.pendingNewSessionItem = item;
      }
      this.emit('session_restart', item);
      logger.info({
        prompt: item.prompt ? item.prompt.substring(0, 50) : '(no prompt)',
        resumeSessionId: item.resumeSessionId ? '***' : undefined,
      }, 'New session started');
    } catch (error) {
      logger.error({ error, retryCount: this.restartRetryCount }, 'Failed to start new session');

      // Retry logic: 1 retry (1 second delay)
      if (this.restartRetryCount < AutoExecutor.MAX_RESTART_RETRIES) {
        this.restartRetryCount++;
        logger.info({ retryCount: this.restartRetryCount }, 'Retrying new session start');

        await new Promise(resolve => setTimeout(resolve, AutoExecutor.RESTART_RETRY_DELAY_MS));

        // Recursive retry
        return this.handleNewSession(item);
      }

      // Max retries exceeded - give up and notify user
      this.restartRetryCount = 0;
      this.deps.display.showMessage('error', NEW_SESSION_MESSAGES.FAILED_MAX_RETRIES);

      // Re-add item to queue front for manual retry later (preserve metadata)
      try {
        await this.deps.queueManager.prependItem(item.prompt, this.toAddItemOptions(item));
        logger.info('Failed new session item re-added to queue front for later retry');
      } catch (queueError) {
        logger.error({ queueError }, 'Failed to re-add item to queue');
      }
      this.currentExecutingItem = null;
      this.stop();
      this.deps.display.setPaused(true);
      this.emit('task_failed', NEW_SESSION_MESSAGES.FAILED);
      this.deps.telegramNotifier?.notify('task_failed', {
        queueLength: this.deps.queueManager.getLength(),
        message: NEW_SESSION_MESSAGES.FAILED,
      });
      this.deps.terminalEmulator?.clear();
    }
  }

  /**
   * Truncate prompt for display
   */
  private truncatePrompt(prompt: string, maxLength: number = 30): string {
    return prompt.length > maxLength
      ? prompt.slice(0, maxLength) + '...'
      : prompt;
  }

  /**
   * Start auto-execution
   */
  start(): void {
    this.enabled = true;
    logger.info('Auto-executor started');
  }

  /**
   * Stop auto-execution
   */
  stop(): void {
    this.enabled = false;
    logger.info('Auto-executor stopped');
  }

  /**
   * Check if auto-execution is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Check if PTY exit happened during a session load (recoverable)
   * Returns true if there's a pending new session item waiting for READY
   */
  hasPendingSessionLoad(): boolean {
    return this.pendingNewSessionItem !== null || !!this.currentExecutingItem?.resumeSessionId;
  }

  /**
   * Handle PTY exit during session load (--resume failed)
   * Treats it as a task failure: re-adds item to queue, pauses, notifies
   */
  async handlePtyExitDuringSessionLoad(): Promise<void> {
    const item = this.pendingNewSessionItem ?? this.currentExecutingItem;
    if (!item || !item.resumeSessionId) return;

    this.pendingNewSessionItem = null;
    this.currentExecutingItem = null;

    // Re-add the failed item to queue front
    try {
      await this.deps.queueManager.prependItem(item.prompt, this.toAddItemOptions(item));
      logger.info(
        { prompt: item.prompt.substring(0, 50), resumeSessionId: item.resumeSessionId ? '***' : undefined },
        'Session load failed item re-added to queue front'
      );
    } catch (err) {
      logger.error({ err }, 'Failed to re-add session load item to queue');
    }

    const queueLength = this.deps.queueManager.getLength();

    // Stop auto-execution
    this.stop();
    this.deps.display.setPaused(true);

    const label = item.loadSessionLabel ? `"${item.loadSessionLabel}"` : 'unknown';
    this.deps.display.showMessage('error', `[Queue] Session load failed (${label}). Auto-execution stopped (${queueLength} items remaining).`);

    // Emit event and send Telegram notification
    this.emit('task_failed', `Session load failed: ${label}`);
    this.deps.telegramNotifier?.notify('task_failed', {
      queueLength,
      message: `Session load failed: ${label}`,
    });

    // Reset terminal emulator
    this.deps.terminalEmulator?.clear();

    logger.warn({ label, queueLength }, 'Session load failed, auto-execution stopped');
  }

  /**
   * Check if queue execution is currently active
   */
  isQueueActive(): boolean {
    return this.queueExecutionActive && this.enabled;
  }

  /**
   * Handle PTY crash during queue execution.
   * Re-adds the current executing item to queue front for retry after restart.
   */
  async handlePtyCrashRecovery(): Promise<void> {
    const itemsToRecover: QueueItem[] = [];
    if (this.currentExecutingItem) {
      itemsToRecover.push(this.currentExecutingItem);
    }
    if (this.pendingNewSessionItem && !itemsToRecover.includes(this.pendingNewSessionItem)) {
      itemsToRecover.push(this.pendingNewSessionItem);
    }

    for (let i = itemsToRecover.length - 1; i >= 0; i--) {
      const item = itemsToRecover[i];
      try {
        await this.deps.queueManager.prependItem(item.prompt, this.toAddItemOptions(item));
        logger.info(
          { prompt: item.prompt.substring(0, 50), resumeSessionId: item.resumeSessionId ? '***' : undefined },
          'Crashed item re-added to queue front'
        );
      } catch (err) {
        logger.error({ err }, 'Failed to re-add crashed item to queue');
      }
    }
    this.currentExecutingItem = null;
    this.pendingNewSessionItem = null;

    // Reset state detector for fresh READY detection after PTY restart
    this.deps.stateDetector.reset();

    // Reset terminal emulator
    this.deps.terminalEmulator?.clear();
  }

  /**
   * Convert QueueItem to add/prepend options while preserving metadata.
   */
  private toAddItemOptions(item: QueueItem): AddItemOptions {
    return {
      isNewSession: item.isNewSession,
      isBreakpoint: item.isBreakpoint,
      labelSession: item.labelSession,
      resumeSessionId: item.resumeSessionId,
      loadSessionLabel: item.loadSessionLabel,
      isMultiline: item.isMultiline,
    };
  }
}
