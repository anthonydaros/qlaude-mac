/**
 * Queue item representing a single prompt in the queue
 */
export interface QueueItem {
  prompt: string;
  isNewSession: boolean;
  isBreakpoint?: boolean;      // Pause auto-execution when reached
  labelSession?: string;       // Save current session with this label
  resumeSessionId?: string;    // Resume this session ID (with --resume)
  loadSessionLabel?: string;   // Label to resolve at execution time (deferred lookup)
  isMultiline?: boolean;       // Prompt contains newlines (parsed from >>( ... >>) block)
  modelName?: string;          // Model switch: non-empty model name (e.g. 'opus')
  delayMs?: number;            // Delay execution by this many milliseconds
  addedAt?: Date;
}

/**
 * Options for adding items to the queue
 */
export interface AddItemOptions {
  isNewSession?: boolean;
  isBreakpoint?: boolean;
  labelSession?: string;
  resumeSessionId?: string;
  loadSessionLabel?: string;
  isMultiline?: boolean;
  modelName?: string;
  delayMs?: number;
}

/**
 * Types of events emitted by QueueManager
 */
export type QueueEventType =
  | 'item_added'
  | 'item_removed'
  | 'item_executed'
  | 'queue_reloaded'
  | 'queue_cleared'
  | 'file_read_error'
  | 'file_write_error'
  | 'file_recovered';

/**
 * Event payload for queue events
 */
export interface QueueEvent {
  type: QueueEventType;
  item?: QueueItem;
  queueLength: number;
  timestamp: Date;
}

/**
 * Event handler signatures for QueueManager EventEmitter
 */
export interface QueueManagerEvents {
  item_added: (event: QueueEvent) => void;
  item_removed: (event: QueueEvent) => void;
  item_executed: (event: QueueEvent) => void;
  queue_reloaded: (event: QueueEvent) => void;
  file_read_error: () => void;
  file_write_error: () => void;
  file_recovered: () => void;
}

/**
 * Result of queue reload operation
 */
export interface ReloadResult {
  success: boolean;
  fileFound: boolean;
  itemCount: number;
  skippedLines: number;
}
