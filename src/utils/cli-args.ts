/**
 * Collects CLI arguments after the script name.
 * Node.js process.argv format: [node, script, ...args]
 * @param argv - The process.argv array (defaults to process.argv)
 * @returns Array of arguments after the script name
 */
export function collectClaudeArgs(argv: string[] = process.argv): string[] {
  return argv.slice(2);
}

/**
 * Builds the spawn arguments for the PTY based on platform.
 * Windows: ['/c', 'claude', ...args]
 * Unix: [...args]
 * @param claudeArgs - The arguments to pass to Claude Code
 * @param platform - The platform (defaults to process.platform)
 * @returns Object containing shell and args for PTY spawn
 */
export function buildPtySpawnArgs(
  claudeArgs: string[],
  platform: string = process.platform
): { shell: string; args: string[] } {
  const isWindows = platform === 'win32';
  const shell = isWindows ? 'cmd.exe' : 'claude';
  const args = isWindows ? ['/c', 'claude', ...claudeArgs] : claudeArgs;
  return { shell, args };
}
