#!/usr/bin/env node

/**
 * qlaude-remove-hooks - Remove qlaude's Claude Code hooks
 *
 * This script is run during npm uninstall to clean up the SessionStart hook.
 * It only removes the qlaude hook, preserving any other user hooks.
 *
 * Usage: npx qlaude-remove-hooks
 */

import { removeHook, isHookInstalled } from '../utils/hook-setup.js';

function main(): void {
  console.log('qlaude: Removing Claude Code hooks...');

  if (!isHookInstalled()) {
    console.log('qlaude: SessionStart hook not found, nothing to remove');
    return;
  }

  try {
    const removed = removeHook();

    if (removed) {
      console.log('qlaude: SessionStart hook removed successfully');
    } else {
      console.log('qlaude: Hook was not present');
    }
  } catch (err) {
    console.error('qlaude: Failed to remove hook:', err);
    console.log('qlaude: You can manually remove "qlaude-session-hook" from your Claude Code settings');
    // Don't exit with error to not block npm uninstall
  }
}

main();
