import { logger } from './utils/logger.js';
import type { ParseResult } from './types/input.js';

// Known :command names (only these are parsed as commands)
// All interactive commands use : prefix and are executed immediately
const KNOWN_COMMANDS = [
  'add', 'drop', 'clear',
  'save', 'load', 'model',
  'pause', 'resume', 'reload', 'status', 'help', 'list',
] as const;

/**
 * Check if the input is a qlaude command (not passthrough)
 */
export function isQueueCommand(input: string): boolean {
  return parse(input).type !== 'PASSTHROUGH';
}

/**
 * Parse user input and determine command type
 *
 * All commands use : prefix (interactive only):
 *   `:add prompt`, `:add @directive`, `:drop`, `:clear`,
 *   `:save name`, `:load name`,
 *   `:pause`, `:resume`, `:reload`, `:status`, `:help`, `:list`
 *
 * Queue file directives use @ prefix (parsed separately by QueueManager)
 */
export function parse(input: string): ParseResult {
  const rawInput = input;

  // --- Colon commands: `:command [args]` ---
  if (input.startsWith(':')) {
    const rest = input.slice(1);
    // Extract command name (first word, case-insensitive)
    const spaceIdx = rest.indexOf(' ');
    const cmdRaw = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
    const cmdName = cmdRaw.toLowerCase();

    // Only parse known commands
    if (!KNOWN_COMMANDS.includes(cmdName as typeof KNOWN_COMMANDS[number])) {
      return { type: 'PASSTHROUGH', rawInput };
    }

    const args = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();

    switch (cmdName) {
      case 'add': {
        const prompt = args || undefined;
        logger.debug({ prompt: prompt || '(empty)' }, 'Parsed QUEUE_ADD command');
        return { type: 'QUEUE_ADD', prompt, rawInput };
      }
      case 'drop':
        logger.debug({ rawInput }, 'Parsed QUEUE_REMOVE command');
        return { type: 'QUEUE_REMOVE', rawInput };
      case 'clear':
        logger.debug({ rawInput }, 'Parsed QUEUE_CLEAR command');
        return { type: 'QUEUE_CLEAR', rawInput };
      case 'save': {
        const label = args || undefined;
        logger.debug({ label }, 'Parsed QUEUE_SAVE_SESSION command');
        return { type: 'QUEUE_SAVE_SESSION', label, rawInput };
      }
      case 'load': {
        const label = args || undefined;
        logger.debug({ label }, 'Parsed QUEUE_LOAD_SESSION command');
        return { type: 'QUEUE_LOAD_SESSION', label, rawInput };
      }
      case 'model': {
        const label = args || undefined;
        logger.debug({ model: label }, 'Parsed META_MODEL command');
        return { type: 'META_MODEL', label, rawInput };
      }
      case 'pause':
        logger.debug({ rawInput }, 'Parsed META_PAUSE command');
        return { type: 'META_PAUSE', rawInput };
      case 'resume':
        logger.debug({ rawInput }, 'Parsed META_RESUME command');
        return { type: 'META_RESUME', rawInput };
      case 'reload':
        logger.debug({ rawInput }, 'Parsed META_RELOAD command');
        return { type: 'META_RELOAD', rawInput };
      case 'status':
        logger.debug({ rawInput }, 'Parsed META_STATUS command');
        return { type: 'META_STATUS', rawInput };
      case 'help':
        logger.debug({ rawInput }, 'Parsed META_HELP command');
        return { type: 'META_HELP', rawInput };
      case 'list':
        logger.debug({ rawInput }, 'Parsed META_LIST command');
        return { type: 'META_LIST', rawInput };
    }
  }

  // Default: passthrough to Claude Code
  return { type: 'PASSTHROUGH', rawInput };
}
