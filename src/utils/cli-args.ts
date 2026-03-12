/**
 * Parsed qlaude-specific CLI arguments
 */
export interface QlaudeArgs {
  /** Path to queue file to copy into .qlaude/queue */
  queueFile?: string;
  /** Override startPaused to false (start executing immediately) */
  run?: boolean;
  /** Remaining arguments to pass through to Claude Code */
  claudeArgs: string[];
}

/**
 * Parse CLI arguments, separating qlaude-specific flags from Claude Code args.
 *
 * qlaude uses triple-dash (---) prefix to guarantee zero collision with
 * Claude Code flags (which use standard - and -- prefixes).
 *
 * qlaude flags:
 *   ---run             Start executing immediately (override startPaused)
 *   ---file <file>     Load queue file into .qlaude/queue
 *
 * Everything else is passed through to Claude Code unchanged.
 *
 * @param argv - The process.argv array (defaults to process.argv)
 * @returns Parsed qlaude args and remaining Claude args
 */
export function parseArgs(argv: string[] = process.argv): QlaudeArgs {
  const args = argv.slice(2);
  const result: QlaudeArgs = { claudeArgs: [] };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    if (arg === '---run') {
      result.run = true;
      i++;
      continue;
    }

    if (arg === '---file') {
      if (i + 1 < args.length) {
        result.queueFile = args[i + 1];
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    // Drop unknown --- flags (qlaude namespace, never pass to Claude)
    if (arg.startsWith('---')) {
      i++;
      continue;
    }

    // Everything else → Claude Code
    result.claudeArgs.push(arg);
    i++;
  }

  return result;
}

/**
 * Builds the spawn arguments for the PTY.
 * @param claudeArgs - The arguments to pass to Claude Code
 * @returns Object containing shell and args for PTY spawn
 */
export function buildPtySpawnArgs(claudeArgs: string[]): { shell: string; args: string[] } {
  return { shell: 'claude', args: claudeArgs };
}
