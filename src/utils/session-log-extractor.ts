/**
 * SessionLogExtractor - Extracts conversation from Claude Code's JSONL session files
 *
 * Reads the session JSONL files from ~/.claude/projects/{project}/
 * and extracts clean Q&A pairs without any terminal noise.
 */

import { readFileSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { logger } from './logger.js';

/**
 * Validate that a session ID contains only safe characters.
 * Claude session IDs are UUIDs (alphanumeric + hyphens).
 * This prevents path traversal via crafted session IDs like "../../etc/passwd".
 */
function isValidSessionId(sessionId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(sessionId);
}

interface SessionIndex {
  version: number;
  entries: SessionEntry[];
}

interface SessionEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}

interface JsonlMessage {
  type: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
  };
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
}

interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  name?: string;
  input?: unknown;
}

export interface ConversationEntry {
  timestamp: string;
  question: string;
  answer: string;
}

/**
 * Get the Claude projects directory path
 */
function getClaudeProjectsDir(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Convert current working directory to Claude's project folder name
 * e.g., "D:\repo\qlaude" -> "d--repo-qlaude"
 */
function cwdToProjectFolder(cwd: string): string {
  // Normalize path separators and convert to lowercase
  return cwd
    .replace(/\\/g, '-')
    .replace(/:/g, '-')
    .replace(/^-+/, '')
    .toLowerCase()
    .replace(/-+/g, '-');
}

/**
 * Find the project folder path (case-insensitive search)
 */
function findProjectFolder(cwd: string): string | null {
  const projectsDir = getClaudeProjectsDir();
  const expectedName = cwdToProjectFolder(cwd);

  if (!existsSync(projectsDir)) {
    return null;
  }

  // Try exact match first (case variations)
  const variations = [
    expectedName,
    expectedName.charAt(0).toUpperCase() + expectedName.slice(1),
    cwd.replace(/\\/g, '-').replace(/:/g, '-').replace(/^-+/, ''),
  ];

  for (const variation of variations) {
    const fullPath = join(projectsDir, variation);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

/**
 * Get all existing session IDs from sessions-index.json
 * Use this before starting Claude Code to track which sessions exist
 */
export function getExistingSessionIds(cwd: string): Set<string> {
  const projectFolder = findProjectFolder(cwd);
  if (!projectFolder) {
    return new Set();
  }

  const indexPath = join(projectFolder, 'sessions-index.json');
  if (!existsSync(indexPath)) {
    return new Set();
  }

  try {
    const content = readFileSync(indexPath, 'utf-8');
    const index: SessionIndex = JSON.parse(content);

    if (!index.entries) {
      return new Set();
    }

    return new Set(index.entries.map(e => e.sessionId));
  } catch (err) {
    logger.error({ err, indexPath }, 'Failed to read sessions-index.json');
    return new Set();
  }
}

/**
 * Find a newly created session ID by comparing with previous snapshot
 * Call this after Claude Code starts to find the new session
 * @param afterTimestamp - Only consider sessions created after this timestamp
 */
export function findNewSessionId(
  cwd: string,
  previousIds: Set<string>,
  afterTimestamp?: Date
): string | null {
  const projectFolder = findProjectFolder(cwd);
  if (!projectFolder) {
    logger.debug({ cwd }, 'Project folder not found');
    return null;
  }

  const indexPath = join(projectFolder, 'sessions-index.json');
  if (!existsSync(indexPath)) {
    logger.debug({ indexPath }, 'sessions-index.json not found');
    return null;
  }

  try {
    const content = readFileSync(indexPath, 'utf-8');
    const index: SessionIndex = JSON.parse(content);

    if (!index.entries || index.entries.length === 0) {
      return null;
    }

    // Find sessions that:
    // 1. Weren't in the previous snapshot
    // 2. Were created AFTER the snapshot timestamp (to exclude sessions added by other processes)
    const newSessions = index.entries.filter(e => {
      if (previousIds.has(e.sessionId)) {
        return false;
      }
      if (afterTimestamp && new Date(e.created) <= afterTimestamp) {
        logger.debug(
          { sessionId: e.sessionId, created: e.created, afterTimestamp: afterTimestamp.toISOString() },
          'Session excluded: created before snapshot'
        );
        return false;
      }
      return true;
    });

    if (newSessions.length === 0) {
      // No new sessions found - do NOT fall back to existing sessions
      // as they may belong to other Claude Code instances (e.g., VSCode)
      logger.debug(
        { totalSessions: index.entries.length, snapshotSize: previousIds.size },
        'No new sessions found since snapshot'
      );
      return null;
    }

    // Return the most recently created new session
    const sorted = [...newSessions].sort((a, b) => {
      return new Date(b.created).getTime() - new Date(a.created).getTime();
    });

    logger.debug({ sessionId: sorted[0].sessionId }, 'Found new session ID');
    return sorted[0].sessionId;
  } catch (err) {
    logger.error({ err, indexPath }, 'Failed to find new session ID');
    return null;
  }
}

/**
 * Get the current session ID from sessions-index.json
 * Returns the most recently modified session
 */
export function getCurrentSessionId(cwd: string): string | null {
  const projectFolder = findProjectFolder(cwd);
  if (!projectFolder) {
    logger.debug({ cwd }, 'Project folder not found');
    return null;
  }

  const indexPath = join(projectFolder, 'sessions-index.json');
  if (!existsSync(indexPath)) {
    logger.debug({ indexPath }, 'sessions-index.json not found');
    return null;
  }

  try {
    const content = readFileSync(indexPath, 'utf-8');
    const index: SessionIndex = JSON.parse(content);

    if (!index.entries || index.entries.length === 0) {
      return null;
    }

    // Find most recently modified session
    const sorted = [...index.entries].sort((a, b) => {
      return new Date(b.modified).getTime() - new Date(a.modified).getTime();
    });

    return sorted[0].sessionId;
  } catch (err) {
    logger.error({ err, indexPath }, 'Failed to read sessions-index.json');
    return null;
  }
}

/**
 * Get the JSONL file path for a session
 */
export function getSessionFilePath(cwd: string, sessionId: string): string | null {
  if (!isValidSessionId(sessionId)) {
    logger.warn({ sessionId }, 'Invalid session ID format, rejecting');
    return null;
  }

  const projectFolder = findProjectFolder(cwd);
  if (!projectFolder) {
    return null;
  }

  const jsonlPath = join(projectFolder, `${sessionId}.jsonl`);
  if (existsSync(jsonlPath)) {
    return jsonlPath;
  }

  return null;
}

/**
 * Extract conversations from a session JSONL file
 */
export function extractConversations(sessionFilePath: string): ConversationEntry[] {
  if (!existsSync(sessionFilePath)) {
    logger.warn({ sessionFilePath }, 'Session file not found');
    return [];
  }

  const conversations: ConversationEntry[] = [];
  let currentQuestion: { text: string; timestamp: string } | null = null;
  let currentAnswer = '';

  try {
    const content = readFileSync(sessionFilePath, 'utf-8');
    const lines = content.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      try {
        const msg: JsonlMessage = JSON.parse(line);

        // User message (question)
        if (msg.type === 'user' && msg.message?.role === 'user') {
          // If we have a pending Q&A, save it first
          if (currentQuestion && currentAnswer) {
            conversations.push({
              timestamp: currentQuestion.timestamp,
              question: currentQuestion.text,
              answer: currentAnswer.trim(),
            });
          }

          // Extract question text
          const content = msg.message.content;
          let questionText = '';

          if (typeof content === 'string') {
            questionText = content;
          } else if (Array.isArray(content)) {
            // Find text content, skip tool_result
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                questionText = block.text;
                break;
              }
            }
          }

          // Skip tool results (they're not real user questions)
          if (questionText && !isToolResult(content)) {
            currentQuestion = {
              text: questionText,
              timestamp: msg.timestamp || new Date().toISOString(),
            };
            currentAnswer = '';
          }
        }

        // Assistant message (answer)
        if (msg.type === 'assistant' && msg.message?.role === 'assistant') {
          const content = msg.message.content;

          if (Array.isArray(content)) {
            for (const block of content) {
              // Only extract text responses, skip thinking/tool_use
              if (block.type === 'text' && block.text) {
                if (currentAnswer) {
                  currentAnswer += '\n';
                }
                currentAnswer += block.text;
              }
            }
          }
        }
      } catch {
        // Skip invalid JSON lines
        continue;
      }
    }

    // Don't forget the last Q&A pair
    if (currentQuestion && currentAnswer) {
      conversations.push({
        timestamp: currentQuestion.timestamp,
        question: currentQuestion.text,
        answer: currentAnswer.trim(),
      });
    }
  } catch (err) {
    logger.error({ err, sessionFilePath }, 'Failed to extract conversations');
  }

  // Deduplicate: keep only the last (most complete) entry for each timestamp+question
  return deduplicateConversations(conversations);
}

/**
 * Deduplicate conversations by keeping only the last (most complete) entry
 * for each timestamp+question combination
 */
function deduplicateConversations(conversations: ConversationEntry[]): ConversationEntry[] {
  const seen = new Map<string, ConversationEntry>();

  for (const entry of conversations) {
    // Create a key from timestamp (truncated to second) and first 100 chars of question
    const timestampKey = entry.timestamp.slice(0, 19); // YYYY-MM-DDTHH:MM:SS
    const questionKey = entry.question.slice(0, 100);
    const key = `${timestampKey}|${questionKey}`;

    const existing = seen.get(key);
    // Keep the entry with the longer (more complete) answer
    if (!existing || entry.answer.length > existing.answer.length) {
      seen.set(key, entry);
    }
  }

  return Array.from(seen.values());
}

/**
 * Check if content is a tool result (not a real user question)
 */
function isToolResult(content: string | ContentBlock[]): boolean {
  if (typeof content === 'string') {
    return false;
  }

  if (Array.isArray(content)) {
    return content.some(block => block.type === 'tool_result');
  }

  return false;
}

/**
 * Format conversations for logging
 */
export function formatConversationsForLog(
  conversations: ConversationEntry[],
  includeTimestamps: boolean = true
): string {
  if (conversations.length === 0) {
    return '';
  }

  const lines: string[] = [];

  for (const entry of conversations) {
    if (includeTimestamps) {
      const timestamp = new Date(entry.timestamp).toISOString().replace('T', ' ').slice(0, -1);
      lines.push(`[${timestamp}]`);
    }

    lines.push(`Q: ${entry.question}`);
    lines.push('');
    lines.push(`A: ${entry.answer}`);
    lines.push('');
    lines.push('─'.repeat(60));
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get the last assistant message context from session log
 * Extracts tool_use (for permission prompts) or text content
 * Returns a formatted string suitable for Telegram notifications
 */
export function getLastAssistantContext(cwd: string, sessionId: string): string | null {
  if (!isValidSessionId(sessionId)) {
    logger.warn({ sessionId }, 'Invalid session ID format, rejecting');
    return null;
  }

  const sessionPath = getSessionFilePath(cwd, sessionId);
  if (!sessionPath || !existsSync(sessionPath)) {
    logger.debug({ cwd, sessionId }, 'Session file not found for context extraction');
    return null;
  }

  try {
    const content = readFileSync(sessionPath, 'utf-8');
    const lines = content.trim().split('\n');

    // Read from end to find last assistant message
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.trim()) continue;

      try {
        const msg: JsonlMessage = JSON.parse(line);

        if (msg.type === 'assistant' && msg.message?.role === 'assistant') {
          const msgContent = msg.message.content;

          if (Array.isArray(msgContent)) {
            // Look for tool_use blocks (permission requests)
            for (const block of msgContent) {
              if (block.type === 'tool_use' && block.name) {
                const toolName = block.name;
                const input = block.input as Record<string, unknown>;

                // Format based on tool type
                if (toolName === 'Bash' && input?.command) {
                  return `Bash: ${String(input.command).slice(0, 200)}`;
                } else if (toolName === 'Write' && input?.file_path) {
                  return `Write: ${input.file_path}`;
                } else if (toolName === 'Edit' && input?.file_path) {
                  return `Edit: ${input.file_path}`;
                } else if (toolName === 'Read' && input?.file_path) {
                  return `Read: ${input.file_path}`;
                } else if (toolName === 'AskUserQuestion' && input?.questions) {
                  // Extract questions and options for selection prompts
                  const questions = input.questions as Array<{
                    question?: string;
                    options?: Array<{ label?: string }>;
                  }>;
                  const lines: string[] = [];
                  for (const q of questions) {
                    if (q.question) {
                      lines.push(q.question);
                    }
                    if (q.options) {
                      for (let i = 0; i < q.options.length; i++) {
                        const opt = q.options[i];
                        if (opt.label) {
                          lines.push(`  ${i + 1}. ${opt.label}`);
                        }
                      }
                    }
                  }
                  return lines.join('\n').slice(0, 500);
                } else {
                  return `${toolName}`;
                }
              }
            }

            // Fall back to text content if no tool_use
            for (const block of msgContent) {
              if (block.type === 'text' && block.text) {
                // Return last ~200 chars of text
                const text = block.text.trim();
                return text.length > 200 ? '...' + text.slice(-200) : text;
              }
            }
          }
        }
      } catch {
        // Skip invalid JSON lines
        continue;
      }
    }

    return null;
  } catch (err) {
    logger.error({ err, sessionId }, 'Failed to extract last assistant context');
    return null;
  }
}
