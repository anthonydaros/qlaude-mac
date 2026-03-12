export const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}
