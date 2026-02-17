/**
 * AutoExecutor types for automatic queue execution
 */

import type { QueueItem } from './queue.js';
import type { StateType } from './state.js';

/**
 * Message constants for consistency and testability
 */
export const NEW_SESSION_MESSAGES = {
  STARTING: '[Queue] Starting new session...',
  FAILED: '[Queue] Failed to start new session',
  FAILED_MAX_RETRIES: '[Queue] Failed to start new session (max retries exceeded)',
} as const;

/**
 * Event handler signatures for AutoExecutor EventEmitter
 */
export interface AutoExecutorEvents {
  executed: (item: QueueItem) => void;
  paused: (state: StateType) => void;
  session_restart: (item: QueueItem) => void;
  queue_started: () => void;
  queue_completed: () => void;
  task_failed: (reason?: string) => void;
  spinner_detected: () => void;
}

/**
 * Configuration options for AutoExecutor
 */
export interface AutoExecutorConfig {
  enabled?: boolean;
}
