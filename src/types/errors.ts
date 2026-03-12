/**
 * Error codes for Qlaude application
 */
export enum ErrorCode {
  // PTY Errors (E1xx)
  PTY_SPAWN_FAILED = 'E101',
  PTY_WRITE_FAILED = 'E102',
  PTY_UNEXPECTED_EXIT = 'E103',
  PTY_SPAWN_HELPER_FAILED = 'E104',

  // Queue Errors (E2xx)
  QUEUE_FILE_READ_FAILED = 'E201',
  QUEUE_FILE_WRITE_FAILED = 'E202',
  QUEUE_PARSE_FAILED = 'E203',

  // State Errors (E3xx)
  STATE_DETECTION_TIMEOUT = 'E301',
  STATE_PATTERN_MISMATCH = 'E302',
}

/**
 * User-friendly error messages for each error code
 */
const userFriendlyMessages: Record<ErrorCode, string> = {
  [ErrorCode.PTY_SPAWN_FAILED]: 'Failed to start Claude Code. Please check if it is installed.',
  [ErrorCode.PTY_WRITE_FAILED]: 'Failed to send input to Claude Code.',
  [ErrorCode.PTY_UNEXPECTED_EXIT]: 'Claude Code exited unexpectedly. Shutting down safely.',
  [ErrorCode.PTY_SPAWN_HELPER_FAILED]: 'Failed to start Claude Code because node-pty spawn-helper is missing or not executable. Reinstall dependencies or fix its execute permission.',
  [ErrorCode.QUEUE_FILE_READ_FAILED]: 'Queue file not found. Using empty queue.',
  [ErrorCode.QUEUE_FILE_WRITE_FAILED]: 'Cannot save queue. Changes may be lost on exit.',
  [ErrorCode.QUEUE_PARSE_FAILED]: 'Queue file corrupted. Using empty queue.',
  [ErrorCode.STATE_DETECTION_TIMEOUT]: 'State detection timed out. Safe mode enabled.',
  [ErrorCode.STATE_PATTERN_MISMATCH]: 'Unknown state detected. Safe mode enabled.',
};

/**
 * Get user-friendly message for an error code
 */
export function getUserFriendlyMessage(code: ErrorCode): string {
  return userFriendlyMessages[code];
}

/**
 * Base error class for Qlaude application
 */
export class QlaudeError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly recoverable: boolean = true,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'QlaudeError';
  }
}

/**
 * Error class for queue-related operations
 */
export class QueueError extends QlaudeError {
  constructor(
    message: string,
    code: ErrorCode,
    recoverable: boolean = true,
    cause?: Error
  ) {
    super(message, code, recoverable, cause);
    this.name = 'QueueError';
  }

  /**
   * Get user-friendly message for this error
   */
  getUserFriendlyMessage(): string {
    return getUserFriendlyMessage(this.code);
  }
}

/**
 * Error class for PTY-related operations
 */
export class PtyError extends QlaudeError {
  constructor(
    message: string,
    code: ErrorCode,
    recoverable: boolean = true,
    cause?: Error
  ) {
    super(message, code, recoverable, cause);
    this.name = 'PtyError';
  }

  /**
   * Get user-friendly message for this error
   */
  getUserFriendlyMessage(): string {
    return getUserFriendlyMessage(this.code);
  }
}

/**
 * Error class for state detection operations
 */
export class StateError extends QlaudeError {
  constructor(
    message: string,
    code: ErrorCode,
    recoverable: boolean = true,
    cause?: Error
  ) {
    super(message, code, recoverable, cause);
    this.name = 'StateError';
  }

  /**
   * Get user-friendly message for this error
   */
  getUserFriendlyMessage(): string {
    return getUserFriendlyMessage(this.code);
  }
}
