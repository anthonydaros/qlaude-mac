#!/usr/bin/env node

/**
 * qlaude-session-hook - SessionStart hook handler for Claude Code
 *
 * This script is called by Claude Code when a session starts.
 * It receives session info via stdin and writes the session_id
 * to a file for the main qlaude process to read.
 *
 * Usage: Automatically invoked by Claude Code's SessionStart hook
 *
 * Input (stdin): JSON with session_id and other metadata
 * Output: Writes session_id to .qlaude/session in current directory
 */

import { resolve } from 'path';
import { existsSync } from 'fs';
import { writeSessionId } from '../utils/hook-setup.js';
import { isValidSessionId } from '../utils/session-id.js';

interface SessionStartInput {
  session_id: string;
  cwd?: string;
  [key: string]: unknown;
}

/**
 * Validate that the given cwd is an existing directory.
 * Resolves to absolute path to prevent path traversal.
 */
function isValidCwd(cwd: string): boolean {
  try {
    const resolved = resolve(cwd);
    return existsSync(resolved);
  } catch {
    return false;
  }
}

/**
 * Read all stdin input
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  try {
    const input = await readStdin();

    if (!input.trim()) {
      // No input provided, exit silently
      process.exit(0);
    }

    const data: SessionStartInput = JSON.parse(input);

    if (!data.session_id) {
      console.error('qlaude-session-hook: No session_id in input');
      process.exit(1);
    }

    // Validate session_id to prevent path traversal
    if (!isValidSessionId(data.session_id)) {
      console.error('qlaude-session-hook: Invalid session_id format');
      process.exit(1);
    }

    // Validate and resolve cwd to prevent path traversal
    const cwd = data.cwd ? resolve(data.cwd) : process.cwd();
    if (data.cwd && !isValidCwd(cwd)) {
      console.error('qlaude-session-hook: Invalid cwd path');
      process.exit(1);
    }

    // Write session ID to file
    writeSessionId(data.session_id, cwd);

    // Exit successfully
    process.exit(0);
  } catch (err) {
    // Log error but don't block Claude Code
    console.error('qlaude-session-hook error:', err);
    process.exit(1);
  }
}

main();
