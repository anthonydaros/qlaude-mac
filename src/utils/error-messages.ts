/**
 * User-friendly error message utilities
 * Maps technical error codes to human-readable messages
 */

import { ErrorCode, getUserFriendlyMessage } from '../types/errors.js';

/**
 * Convert a technical error to a user-friendly message
 * If the error has an error code, returns the mapped message
 * Otherwise, returns a generic error message
 */
export function toUserFriendlyMessage(error: unknown): string {
  if (error instanceof Error && 'code' in error) {
    const code = (error as { code: ErrorCode }).code;
    if (Object.values(ErrorCode).includes(code)) {
      return getUserFriendlyMessage(code);
    }
  }

  // For unknown errors, return a generic message
  if (error instanceof Error) {
    return `An error occurred: ${error.message}`;
  }

  return 'An unexpected error occurred.';
}

// Re-export for convenience
export { getUserFriendlyMessage, ErrorCode };
