/**
 * State types for Claude Code output analysis
 */

/**
 * Claude Code state types
 * - READY: Waiting for new prompt input
 * - PROCESSING: Processing a prompt
 * - SELECTION_PROMPT: Waiting for user input (permission approval, selection, etc.)
 * - INTERRUPTED: Interrupted by user
 * - TASK_FAILED: Task failed with explicit QUEUE_STOP marker
 */
export type StateType =
  | 'READY'
  | 'PROCESSING'
  | 'SELECTION_PROMPT'
  | 'INTERRUPTED'
  | 'TASK_FAILED';

/**
 * Parsed option from selection prompt
 */
export interface ParsedOption {
  number: number;
  text: string;
  /** True if this option requires text input (e.g., "Type something", "Other") */
  isTextInput?: boolean;
}

/**
 * Metadata for state context
 */
export interface StateMetadata {
  matchedPattern?: string;
  bufferSnapshot?: string;
  /** Parsed options for SELECTION_PROMPT state */
  options?: ParsedOption[];
  /** True if spinner pattern detected - suggests Claude may still be processing */
  hasSpinner?: boolean;
  /** Reason for task failure (TASK_FAILED state) */
  failureReason?: string;
}

/**
 * Claude Code state with metadata
 */
export interface ClaudeCodeState {
  type: StateType;
  timestamp: number;
  metadata?: StateMetadata;
}

/**
 * State pattern definition for detection
 */
export interface StatePattern {
  state: StateType;
  patterns: RegExp[];
  priority: number;
}

/**
 * Safe mode state for state detection failures
 */
export interface SafeModeState {
  enabled: boolean;
  consecutiveFailures: number;
  enteredAt?: number;
}

/**
 * State detector event types
 */
export interface StateDetectorEvents {
  state_change: (state: ClaudeCodeState) => void;
  safe_mode: (state: SafeModeState) => void;
  safe_mode_exit: () => void;
}
