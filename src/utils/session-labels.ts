/**
 * Session Labels - Store and retrieve named session IDs
 *
 * Allows users to save Claude session IDs with human-readable labels
 * for later resumption using --resume.
 *
 * Storage: .qlaude/session-labels.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from './logger.js';

/**
 * Session labels storage structure
 */
interface SessionLabelsStorage {
  [label: string]: string;
}

/**
 * Get the session labels file path (per-project)
 * Stored in .qlaude/ directory
 */
export function getSessionLabelsPath(): string {
  return join(process.cwd(), '.qlaude', 'session-labels.json');
}

/**
 * Read all session labels from storage
 */
export function readSessionLabels(): SessionLabelsStorage {
  const filePath = getSessionLabelsPath();

  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as SessionLabelsStorage;
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to read session labels');
    return {};
  }
}

/**
 * Write session labels to storage
 */
function writeSessionLabels(labels: SessionLabelsStorage): void {
  const filePath = getSessionLabelsPath();

  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(labels, null, 2), 'utf-8');
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to write session labels');
    throw err;
  }
}

/**
 * Save a session ID with a label
 * @param label Human-readable label for the session
 * @param sessionId Claude session ID to save
 * @returns true if label was overwritten, false if new
 */
export function saveSessionLabel(label: string, sessionId: string): boolean {
  const labels = readSessionLabels();
  const wasOverwritten = label in labels;
  labels[label] = sessionId;
  writeSessionLabels(labels);
  logger.info({ label, sessionId, wasOverwritten }, 'Session label saved');
  return wasOverwritten;
}

/**
 * Get a session ID by its label
 * @param label The label to look up
 * @returns Session ID or null if not found
 */
export function getSessionLabel(label: string): string | null {
  const labels = readSessionLabels();
  return labels[label] || null;
}

/**
 * Remove a session label
 * @param label The label to remove
 * @returns true if removed, false if not found
 */
export function removeSessionLabel(label: string): boolean {
  const labels = readSessionLabels();

  if (!(label in labels)) {
    return false;
  }

  delete labels[label];
  writeSessionLabels(labels);
  logger.info({ label }, 'Session label removed');
  return true;
}

/**
 * List all session labels
 * @returns Object mapping labels to session IDs
 */
export function listSessionLabels(): SessionLabelsStorage {
  return readSessionLabels();
}
