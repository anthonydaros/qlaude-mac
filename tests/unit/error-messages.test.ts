import { describe, it, expect } from 'vitest';
import {
  toUserFriendlyMessage,
  getUserFriendlyMessage,
  ErrorCode,
} from '../../src/utils/error-messages.js';
import { QlaudeError, PtyError, StateError, QueueError } from '../../src/types/errors.js';

describe('error-messages', () => {
  describe('getUserFriendlyMessage', () => {
    it('should return user-friendly message for PTY_SPAWN_FAILED', () => {
      const message = getUserFriendlyMessage(ErrorCode.PTY_SPAWN_FAILED);
      expect(message).toBe('Failed to start Claude Code. Please check if it is installed.');
    });

    it('should return user-friendly message for PTY_UNEXPECTED_EXIT', () => {
      const message = getUserFriendlyMessage(ErrorCode.PTY_UNEXPECTED_EXIT);
      expect(message).toBe('Claude Code exited unexpectedly. Shutting down safely.');
    });

    it('should return user-friendly message for QUEUE_FILE_READ_FAILED', () => {
      const message = getUserFriendlyMessage(ErrorCode.QUEUE_FILE_READ_FAILED);
      expect(message).toBe('Queue file not found. Using empty queue.');
    });

    it('should return user-friendly message for STATE_DETECTION_TIMEOUT', () => {
      const message = getUserFriendlyMessage(ErrorCode.STATE_DETECTION_TIMEOUT);
      expect(message).toBe('State detection timed out. Safe mode enabled.');
    });

    it('should have messages in English', () => {
      // All messages should be in English
      const allCodes = Object.values(ErrorCode);
      for (const code of allCodes) {
        const message = getUserFriendlyMessage(code);
        // Simple check: message should not contain Korean characters
        expect(message).not.toMatch(/[\u3131-\uD79D]/);
      }
    });
  });

  describe('toUserFriendlyMessage', () => {
    it('should convert PtyError to user-friendly message', () => {
      const error = new PtyError('Technical error', ErrorCode.PTY_SPAWN_FAILED);
      const message = toUserFriendlyMessage(error);
      expect(message).toBe('Failed to start Claude Code. Please check if it is installed.');
    });

    it('should convert StateError to user-friendly message', () => {
      const error = new StateError('Technical error', ErrorCode.STATE_PATTERN_MISMATCH);
      const message = toUserFriendlyMessage(error);
      expect(message).toBe('Unknown state detected. Safe mode enabled.');
    });

    it('should convert QueueError to user-friendly message', () => {
      const error = new QueueError('Technical error', ErrorCode.QUEUE_FILE_WRITE_FAILED);
      const message = toUserFriendlyMessage(error);
      expect(message).toBe('Cannot save queue. Changes may be lost on exit.');
    });

    it('should convert QlaudeError to user-friendly message', () => {
      const error = new QlaudeError('Technical error', ErrorCode.QUEUE_PARSE_FAILED);
      const message = toUserFriendlyMessage(error);
      expect(message).toBe('Queue file corrupted. Using empty queue.');
    });

    it('should handle standard Error with message', () => {
      const error = new Error('Something went wrong');
      const message = toUserFriendlyMessage(error);
      expect(message).toBe('An error occurred: Something went wrong');
    });

    it('should handle unknown error types', () => {
      const error = 'string error';
      const message = toUserFriendlyMessage(error);
      expect(message).toBe('An unexpected error occurred.');
    });

    it('should handle null/undefined', () => {
      expect(toUserFriendlyMessage(null)).toBe('An unexpected error occurred.');
      expect(toUserFriendlyMessage(undefined)).toBe('An unexpected error occurred.');
    });

    it('should handle error objects with unknown code', () => {
      const error = { code: 'UNKNOWN_CODE', message: 'Unknown' };
      const message = toUserFriendlyMessage(error);
      expect(message).toBe('An unexpected error occurred.');
    });
  });

  describe('error message consistency', () => {
    it('should have all error codes mapped to messages', () => {
      const allCodes = Object.values(ErrorCode);
      for (const code of allCodes) {
        const message = getUserFriendlyMessage(code);
        expect(message).toBeTruthy();
        expect(message.length).toBeGreaterThan(0);
      }
    });

    it('should have unique messages for each error code', () => {
      const allCodes = Object.values(ErrorCode);
      const messages = allCodes.map((code) => getUserFriendlyMessage(code));
      const uniqueMessages = new Set(messages);
      expect(uniqueMessages.size).toBe(allCodes.length);
    });
  });
});
