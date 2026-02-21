#!/usr/bin/env node

/**
 * qlaude-setup-hooks - Install qlaude's Claude Code hooks
 *
 * This script is run during npm install to set up the SessionStart hook
 * that provides session_id for conversation logging.
 *
 * Usage: npx qlaude-setup-hooks
 */

import { installHook, isHookInstalled, getClaudeSettingsPath } from '../utils/hook-setup.js';
import { ensureConfigDir } from '../utils/config.js';

function main(): void {
  console.log('qlaude: Setting up Claude Code hooks...');

  // Ensure .qlaude config directory exists
  const created = ensureConfigDir();
  if (created) {
    console.log('qlaude: Created .qlaude/ config directory');
    console.log('');
    console.log('qlaude: Telegram Setup:');
    console.log('  1. Create bot: Message @BotFather on Telegram, send /newbot');
    console.log('  2. Paste bot token in ~/.qlaude/telegram.json');
    console.log('  3. Start chat with your bot and send any message');
    console.log('  4. Get chat ID: https://api.telegram.org/bot<TOKEN>/getUpdates');
    console.log('  5. Set "enabled" to true');
    console.log('');
  } else {
    console.log('qlaude: Config directory already exists');
  }

  if (isHookInstalled()) {
    console.log('qlaude: SessionStart hook already installed');
    return;
  }

  try {
    const added = installHook();

    if (added) {
      console.log('qlaude: SessionStart hook installed successfully');
      console.log(`qlaude: Settings file: ${getClaudeSettingsPath()}`);
    } else {
      console.log('qlaude: Hook was already present');
    }
  } catch (err) {
    console.error('qlaude: Failed to install hook:', err);
    console.log('qlaude: You can manually add "qlaude-session-hook" to your Claude Code SessionStart hooks');
    // Don't exit with error to not block npm install
  }
}

main();
