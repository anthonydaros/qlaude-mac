/**
 * Session Log Offsets - Track how many messages have been extracted per session
 *
 * Prevents duplicate logging when resuming sessions via --resume.
 * Each session ID maps to the number of messages already extracted.
 *
 * Storage: .qlaude/session-log-offsets.json (per-project)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from './logger.js';
import { QLAUDE_DIR } from './config.js';

/**
 * Session log offsets storage structure
 */
interface SessionLogOffsetsStorage {
  [sessionId: string]: number;
}

/**
 * Get the session log offsets file path
 */
export function getSessionLogOffsetsPath(): string {
  return join(process.cwd(), QLAUDE_DIR, 'session-log-offsets.json');
}

/**
 * Read all session log offsets from storage
 */
function readSessionLogOffsets(): SessionLogOffsetsStorage {
  const filePath = getSessionLogOffsetsPath();

  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as SessionLogOffsetsStorage;
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to read session log offsets');
    return {};
  }
}

/**
 * Write session log offsets to storage
 */
function writeSessionLogOffsets(offsets: SessionLogOffsetsStorage): void {
  const filePath = getSessionLogOffsetsPath();

  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(offsets, null, 2), 'utf-8');
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to write session log offsets');
    // Don't throw - logging offset is non-critical
  }
}

/**
 * Get the last extracted message count for a session
 * @param sessionId Claude session ID
 * @returns Number of messages already extracted, or 0 if not found
 */
export function getSessionLogOffset(sessionId: string): number {
  const offsets = readSessionLogOffsets();
  return offsets[sessionId] ?? 0;
}

/**
 * Save the extracted message count for a session
 * @param sessionId Claude session ID
 * @param count Number of messages extracted
 */
export function saveSessionLogOffset(sessionId: string, count: number): void {
  const offsets = readSessionLogOffsets();
  offsets[sessionId] = count;
  writeSessionLogOffsets(offsets);
  logger.debug({ sessionId, count }, 'Session log offset saved');
}

/**
 * Remove a session's log offset (cleanup)
 * @param sessionId Session ID to remove
 * @returns true if removed, false if not found
 */
export function removeSessionLogOffset(sessionId: string): boolean {
  const offsets = readSessionLogOffsets();

  if (!(sessionId in offsets)) {
    return false;
  }

  delete offsets[sessionId];
  writeSessionLogOffsets(offsets);
  logger.debug({ sessionId }, 'Session log offset removed');
  return true;
}
