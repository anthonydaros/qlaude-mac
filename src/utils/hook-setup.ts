/**
 * Hook Setup Utility - Manages Claude Code hooks for qlaude
 *
 * Handles installation and removal of SessionStart hook
 * that provides session_id for conversation logging.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

/**
 * Hook entry in the new Claude Code format
 */
interface HookEntry {
  type: 'command';
  command: string;
}

/**
 * Hook configuration with optional matcher
 * Note: SessionStart doesn't use matchers, so matcher is optional
 */
interface HookConfig {
  matcher?: string | Record<string, unknown>;
  hooks: HookEntry[];
}

/**
 * Claude Code settings structure (new format)
 */
interface ClaudeSettings {
  hooks?: {
    SessionStart?: HookConfig[];
    [key: string]: HookConfig[] | undefined;
  };
  [key: string]: unknown;
}

/**
 * Hook command used by qlaude
 */
export const QLAUDE_HOOK_COMMAND = 'qlaude-session-hook';

/**
 * Get Claude Code settings file path
 */
export function getClaudeSettingsPath(): string {
  return join(homedir(), '.claude', 'settings.json');
}

/**
 * Get session ID file path for a given working directory
 */
export function getSessionIdFilePath(cwd: string = process.cwd()): string {
  return join(cwd, '.qlaude', 'session');
}

interface ReadSettingsResult {
  settings: ClaudeSettings;
  parseError: boolean;
}

function readClaudeSettingsInternal(): ReadSettingsResult {
  const settingsPath = getClaudeSettingsPath();

  if (!existsSync(settingsPath)) {
    return { settings: {}, parseError: false };
  }

  try {
    const content = readFileSync(settingsPath, 'utf-8');
    return {
      settings: JSON.parse(content) as ClaudeSettings,
      parseError: false,
    };
  } catch {
    return { settings: {}, parseError: true };
  }
}

/**
 * Read Claude Code settings
 * @throws Error when settings file exists but contains invalid JSON
 */
export function readClaudeSettings(): ClaudeSettings {
  const { settings, parseError } = readClaudeSettingsInternal();
  if (parseError) {
    throw new Error(`Failed to parse Claude settings: ${getClaudeSettingsPath()}`);
  }
  return settings;
}

/**
 * Write Claude Code settings
 */
export function writeClaudeSettings(settings: ClaudeSettings): void {
  const settingsPath = getClaudeSettingsPath();
  const dir = dirname(settingsPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Check if a hook config contains the qlaude hook command
 */
function hasQlaudeHook(config: HookConfig): boolean {
  return config.hooks.some(h => h.command === QLAUDE_HOOK_COMMAND);
}

/**
 * Check if qlaude hook is already installed
 */
export function isHookInstalled(): boolean {
  const { settings, parseError } = readClaudeSettingsInternal();
  if (parseError) {
    return false;
  }
  const sessionStartHooks = settings.hooks?.SessionStart || [];
  return sessionStartHooks.some(hasQlaudeHook);
}

/**
 * Install qlaude SessionStart hook
 * Merges with existing hooks if present
 * @returns true if hook was added, false if already present
 */
export function installHook(): boolean {
  const { settings, parseError } = readClaudeSettingsInternal();
  if (parseError) {
    throw new Error(`Failed to parse Claude settings: ${getClaudeSettingsPath()}`);
  }

  // Initialize hooks structure if needed
  if (!settings.hooks) {
    settings.hooks = {};
  }

  const existingHooks = settings.hooks.SessionStart || [];

  // Check if already installed
  if (existingHooks.some(hasQlaudeHook)) {
    return false;
  }

  // Create qlaude hook config in new format
  // Note: SessionStart doesn't use matchers, so we omit the matcher field
  const qlaudeHookConfig: HookConfig = {
    hooks: [
      {
        type: 'command',
        command: QLAUDE_HOOK_COMMAND,
      },
    ],
  };

  // Add qlaude hook to existing hooks
  settings.hooks.SessionStart = [...existingHooks, qlaudeHookConfig];

  writeClaudeSettings(settings);
  return true;
}

/**
 * Remove qlaude SessionStart hook
 * Preserves other hooks
 * @returns true if hook was removed, false if not found
 */
export function removeHook(): boolean {
  const { settings, parseError } = readClaudeSettingsInternal();
  if (parseError) {
    throw new Error(`Failed to parse Claude settings: ${getClaudeSettingsPath()}`);
  }

  if (!settings.hooks?.SessionStart) {
    return false;
  }

  const existingHooks = settings.hooks.SessionStart;
  const originalLength = existingHooks.length;

  // Filter out any hook configs that contain the qlaude hook
  const filteredHooks = existingHooks.filter(config => !hasQlaudeHook(config));

  if (filteredHooks.length === originalLength) {
    return false; // Hook was not found
  }

  // Update or clean up
  if (filteredHooks.length === 0) {
    delete settings.hooks.SessionStart;
  } else {
    settings.hooks.SessionStart = filteredHooks;
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeClaudeSettings(settings);
  return true;
}

/**
 * Read session ID from file
 * @param cwd Working directory where session file is located
 * @returns Session ID or null if not found
 */
export function readSessionId(cwd: string = process.cwd()): string | null {
  const sessionFile = getSessionIdFilePath(cwd);

  if (!existsSync(sessionFile)) {
    return null;
  }

  try {
    const content = readFileSync(sessionFile, 'utf-8').trim();
    return content || null;
  } catch {
    return null;
  }
}

/**
 * Write session ID to file
 * @param sessionId Session ID to write (must be alphanumeric/hyphens/underscores only)
 * @param cwd Working directory where session file should be created
 */
export function writeSessionId(sessionId: string, cwd: string = process.cwd()): void {
  // Validate session ID to prevent writing arbitrary content
  if (!/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw new Error('Invalid session ID format');
  }

  const sessionFile = getSessionIdFilePath(cwd);
  const dir = dirname(sessionFile);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(sessionFile, sessionId, { encoding: 'utf-8', mode: 0o600 });
}

/**
 * Delete session ID file
 * @param cwd Working directory where session file is located
 */
export function deleteSessionId(cwd: string = process.cwd()): void {
  const sessionFile = getSessionIdFilePath(cwd);

  if (existsSync(sessionFile)) {
    unlinkSync(sessionFile);
  }
}
