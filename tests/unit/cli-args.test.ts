import { describe, it, expect } from 'vitest';
import { collectClaudeArgs, buildPtySpawnArgs, parseArgs } from '../../src/utils/cli-args.js';

describe('CLI Arguments', () => {
  describe('collectClaudeArgs', () => {
    it('should collect all arguments after qlaude command', () => {
      const argv = ['node', 'qlaude', '--help'];
      expect(collectClaudeArgs(argv)).toEqual(['--help']);
    });

    it('should handle multiple arguments', () => {
      const argv = ['node', 'qlaude', '-p', 'test', '--verbose'];
      expect(collectClaudeArgs(argv)).toEqual(['-p', 'test', '--verbose']);
    });

    it('should preserve argument order', () => {
      const argv = ['node', 'qlaude', '--dangerously-skip-permissions', '-p', 'test'];
      expect(collectClaudeArgs(argv)).toEqual(['--dangerously-skip-permissions', '-p', 'test']);
    });

    it('should handle arguments with spaces in quotes', () => {
      const argv = ['node', 'qlaude', '-p', 'test prompt with spaces'];
      expect(collectClaudeArgs(argv)).toEqual(['-p', 'test prompt with spaces']);
    });

    it('should handle empty arguments', () => {
      const argv = ['node', 'qlaude'];
      expect(collectClaudeArgs(argv)).toEqual([]);
    });

    it('should handle complex argument combinations', () => {
      const argv = [
        'node',
        'qlaude',
        '--dangerously-skip-permissions',
        'hello world',
        '--print',
        '--model',
        'sonnet',
      ];
      expect(collectClaudeArgs(argv)).toEqual([
        '--dangerously-skip-permissions',
        'hello world',
        '--print',
        '--model',
        'sonnet',
      ]);
    });
  });

  describe('parseArgs (--- prefix = qlaude, everything else = Claude)', () => {
    it('should pass all args to Claude when no qlaude flags', () => {
      const result = parseArgs(['node', 'qlaude', '--help']);
      expect(result.queueFile).toBeUndefined();
      expect(result.run).toBeUndefined();
      expect(result.claudeArgs).toEqual(['--help']);
    });

    it('should extract ---run flag', () => {
      const result = parseArgs(['node', 'qlaude', '---run']);
      expect(result.run).toBe(true);
      expect(result.claudeArgs).toEqual([]);
    });

    it('should extract ---file <file>', () => {
      const result = parseArgs(['node', 'qlaude', '---file', 'my-tasks.txt']);
      expect(result.queueFile).toBe('my-tasks.txt');
      expect(result.claudeArgs).toEqual([]);
    });

    it('should combine ---run with ---file', () => {
      const result = parseArgs(['node', 'qlaude', '---run', '---file', 'tasks.txt']);
      expect(result.run).toBe(true);
      expect(result.queueFile).toBe('tasks.txt');
      expect(result.claudeArgs).toEqual([]);
    });

    it('should pass Claude flags through untouched', () => {
      const result = parseArgs(['node', 'qlaude', '---run', '--verbose', '--model', 'opus']);
      expect(result.run).toBe(true);
      expect(result.claudeArgs).toEqual(['--verbose', '--model', 'opus']);
    });

    it('should handle empty args', () => {
      const result = parseArgs(['node', 'qlaude']);
      expect(result.queueFile).toBeUndefined();
      expect(result.run).toBeUndefined();
      expect(result.claudeArgs).toEqual([]);
    });

    it('should handle ---file without file (edge case)', () => {
      const result = parseArgs(['node', 'qlaude', '---file']);
      expect(result.queueFile).toBeUndefined();
      expect(result.claudeArgs).toEqual([]);
    });

    it('should handle complex mixed args', () => {
      const result = parseArgs([
        'node', 'qlaude',
        '---run',
        '---file', 'my-queue.txt',
        '--dangerously-skip-permissions',
        '--model', 'sonnet',
      ]);
      expect(result.run).toBe(true);
      expect(result.queueFile).toBe('my-queue.txt');
      expect(result.claudeArgs).toEqual([
        '--dangerously-skip-permissions',
        '--model', 'sonnet',
      ]);
    });

    // Zero collision: all Claude flags pass through
    it('should pass -r (--resume) through to Claude', () => {
      const result = parseArgs(['node', 'qlaude', '-r', 'session-123']);
      expect(result.run).toBeUndefined();
      expect(result.claudeArgs).toEqual(['-r', 'session-123']);
    });

    it('should pass --resume through to Claude', () => {
      const result = parseArgs(['node', 'qlaude', '--resume', 'session-id']);
      expect(result.claudeArgs).toEqual(['--resume', 'session-id']);
    });

    it('should pass -p through to Claude', () => {
      const result = parseArgs(['node', 'qlaude', '-p', 'hello world']);
      expect(result.claudeArgs).toEqual(['-p', 'hello world']);
    });

    it('should pass -c (--continue) through to Claude', () => {
      const result = parseArgs(['node', 'qlaude', '-c']);
      expect(result.claudeArgs).toEqual(['-c']);
    });

    it('should pass --debug through to Claude', () => {
      const result = parseArgs(['node', 'qlaude', '--debug', 'api,hooks']);
      expect(result.claudeArgs).toEqual(['--debug', 'api,hooks']);
    });

    it('should handle ---run mixed with Claude flags', () => {
      const result = parseArgs(['node', 'qlaude', '---run', '-r', 'session-123', '--verbose']);
      expect(result.run).toBe(true);
      expect(result.claudeArgs).toEqual(['-r', 'session-123', '--verbose']);
    });

    it('should pass positional args (Claude prompts) through', () => {
      const result = parseArgs(['node', 'qlaude', 'hello world']);
      expect(result.claudeArgs).toEqual(['hello world']);
    });

    it('should drop unknown --- flags silently', () => {
      const result = parseArgs(['node', 'qlaude', '---foo', '---bar', '--verbose']);
      expect(result.claudeArgs).toEqual(['--verbose']);
    });
  });

  describe('buildPtySpawnArgs', () => {
    it('should build Windows spawn args with cmd.exe wrapper', () => {
      const result = buildPtySpawnArgs(['--help'], 'win32');
      expect(result.shell).toBe('cmd.exe');
      expect(result.args).toEqual(['/c', 'claude', '--help']);
    });

    it('should build Unix spawn args without wrapper', () => {
      const result = buildPtySpawnArgs(['--help'], 'linux');
      expect(result.shell).toBe('claude');
      expect(result.args).toEqual(['--help']);
    });

    it('should handle macOS as Unix', () => {
      const result = buildPtySpawnArgs(['--version'], 'darwin');
      expect(result.shell).toBe('claude');
      expect(result.args).toEqual(['--version']);
    });

    it('should preserve argument order on Windows', () => {
      const args = ['--dangerously-skip-permissions', '-p', 'test'];
      const result = buildPtySpawnArgs(args, 'win32');
      expect(result.args).toEqual(['/c', 'claude', '--dangerously-skip-permissions', '-p', 'test']);
    });

    it('should preserve argument order on Unix', () => {
      const args = ['--dangerously-skip-permissions', '-p', 'test'];
      const result = buildPtySpawnArgs(args, 'linux');
      expect(result.args).toEqual(['--dangerously-skip-permissions', '-p', 'test']);
    });

    it('should handle empty arguments on Windows', () => {
      const result = buildPtySpawnArgs([], 'win32');
      expect(result.args).toEqual(['/c', 'claude']);
    });

    it('should handle empty arguments on Unix', () => {
      const result = buildPtySpawnArgs([], 'linux');
      expect(result.args).toEqual([]);
    });
  });
});
