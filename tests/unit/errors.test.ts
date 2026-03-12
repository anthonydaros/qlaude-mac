import { describe, it, expect } from 'vitest';
import {
  ErrorCode,
  QlaudeError,
  QueueError,
  PtyError,
  StateError,
  getUserFriendlyMessage,
} from '../../src/types/errors.js';

describe('ErrorCode', () => {
  it('should have correct PTY error codes', () => {
    expect(ErrorCode.PTY_SPAWN_FAILED).toBe('E101');
    expect(ErrorCode.PTY_WRITE_FAILED).toBe('E102');
    expect(ErrorCode.PTY_UNEXPECTED_EXIT).toBe('E103');
    expect(ErrorCode.PTY_SPAWN_HELPER_FAILED).toBe('E104');
  });

  it('should have correct Queue error codes', () => {
    expect(ErrorCode.QUEUE_FILE_READ_FAILED).toBe('E201');
    expect(ErrorCode.QUEUE_FILE_WRITE_FAILED).toBe('E202');
    expect(ErrorCode.QUEUE_PARSE_FAILED).toBe('E203');
  });

  it('should have correct State error codes', () => {
    expect(ErrorCode.STATE_DETECTION_TIMEOUT).toBe('E301');
    expect(ErrorCode.STATE_PATTERN_MISMATCH).toBe('E302');
  });
});

describe('getUserFriendlyMessage', () => {
  it('should return user-friendly message for PTY errors', () => {
    expect(getUserFriendlyMessage(ErrorCode.PTY_SPAWN_FAILED)).toBe(
      'Failed to start Claude Code. Please check if it is installed.'
    );
    expect(getUserFriendlyMessage(ErrorCode.PTY_SPAWN_HELPER_FAILED)).toBe(
      'Failed to start Claude Code because node-pty spawn-helper is missing or not executable. Reinstall dependencies or fix its execute permission.'
    );
    expect(getUserFriendlyMessage(ErrorCode.PTY_UNEXPECTED_EXIT)).toBe(
      'Claude Code exited unexpectedly. Shutting down safely.'
    );
  });

  it('should return user-friendly message for Queue errors', () => {
    expect(getUserFriendlyMessage(ErrorCode.QUEUE_FILE_READ_FAILED)).toBe(
      'Queue file not found. Using empty queue.'
    );
    expect(getUserFriendlyMessage(ErrorCode.QUEUE_FILE_WRITE_FAILED)).toBe(
      'Cannot save queue. Changes may be lost on exit.'
    );
  });

  it('should return user-friendly message for State errors', () => {
    expect(getUserFriendlyMessage(ErrorCode.STATE_DETECTION_TIMEOUT)).toBe(
      'State detection timed out. Safe mode enabled.'
    );
    expect(getUserFriendlyMessage(ErrorCode.STATE_PATTERN_MISMATCH)).toBe(
      'Unknown state detected. Safe mode enabled.'
    );
  });
});

describe('QlaudeError', () => {
  it('should create error with correct properties', () => {
    const error = new QlaudeError('Test error', ErrorCode.QUEUE_PARSE_FAILED);
    expect(error.message).toBe('Test error');
    expect(error.code).toBe(ErrorCode.QUEUE_PARSE_FAILED);
    expect(error.recoverable).toBe(true);
    expect(error.name).toBe('QlaudeError');
  });

  it('should create error with recoverable flag', () => {
    const error = new QlaudeError('Fatal error', ErrorCode.PTY_SPAWN_FAILED, false);
    expect(error.recoverable).toBe(false);
  });

  it('should create error with cause', () => {
    const cause = new Error('Original error');
    const error = new QlaudeError('Wrapped error', ErrorCode.QUEUE_FILE_READ_FAILED, true, cause);
    expect(error.cause).toBe(cause);
  });
});

describe('QueueError', () => {
  it('should create QueueError with correct name', () => {
    const error = new QueueError('Queue read failed', ErrorCode.QUEUE_FILE_READ_FAILED);
    expect(error.name).toBe('QueueError');
    expect(error.code).toBe('E201');
  });

  it('should be an instance of QlaudeError', () => {
    const error = new QueueError('Queue error', ErrorCode.QUEUE_PARSE_FAILED);
    expect(error).toBeInstanceOf(QlaudeError);
  });

  it('should return user-friendly message', () => {
    const error = new QueueError('Technical error', ErrorCode.QUEUE_FILE_WRITE_FAILED);
    expect(error.getUserFriendlyMessage()).toBe(
      'Cannot save queue. Changes may be lost on exit.'
    );
  });
});

describe('PtyError', () => {
  it('should create PtyError with correct properties', () => {
    const error = new PtyError('Spawn failed', ErrorCode.PTY_SPAWN_FAILED);
    expect(error.name).toBe('PtyError');
    expect(error.code).toBe('E101');
    expect(error.recoverable).toBe(true);
  });

  it('should be an instance of QlaudeError', () => {
    const error = new PtyError('PTY error', ErrorCode.PTY_WRITE_FAILED);
    expect(error).toBeInstanceOf(QlaudeError);
  });

  it('should return user-friendly message', () => {
    const error = new PtyError('Technical error', ErrorCode.PTY_UNEXPECTED_EXIT);
    expect(error.getUserFriendlyMessage()).toBe(
      'Claude Code exited unexpectedly. Shutting down safely.'
    );
  });

  it('should create non-recoverable error', () => {
    const error = new PtyError('Fatal PTY error', ErrorCode.PTY_SPAWN_FAILED, false);
    expect(error.recoverable).toBe(false);
  });
});

describe('StateError', () => {
  it('should create StateError with correct properties', () => {
    const error = new StateError('Detection timeout', ErrorCode.STATE_DETECTION_TIMEOUT);
    expect(error.name).toBe('StateError');
    expect(error.code).toBe('E301');
    expect(error.recoverable).toBe(true);
  });

  it('should be an instance of QlaudeError', () => {
    const error = new StateError('State error', ErrorCode.STATE_PATTERN_MISMATCH);
    expect(error).toBeInstanceOf(QlaudeError);
  });

  it('should return user-friendly message', () => {
    const error = new StateError('Technical error', ErrorCode.STATE_DETECTION_TIMEOUT);
    expect(error.getUserFriendlyMessage()).toBe('State detection timed out. Safe mode enabled.');
  });

  it('should preserve cause error', () => {
    const cause = new Error('Original');
    const error = new StateError('Wrapped', ErrorCode.STATE_PATTERN_MISMATCH, true, cause);
    expect(error.cause).toBe(cause);
  });
});
