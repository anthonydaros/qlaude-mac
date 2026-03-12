import { describe, it, expect } from 'vitest';
import { buildPtySpawnArgs, parseArgs } from '../../src/utils/cli-args.js';

describe('CLI Arguments', () => {
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
    it('should always use claude as shell', () => {
      const result = buildPtySpawnArgs(['--help']);
      expect(result.shell).toBe('claude');
      expect(result.args).toEqual(['--help']);
    });

    it('should preserve argument order', () => {
      const args = ['--dangerously-skip-permissions', '-p', 'test'];
      const result = buildPtySpawnArgs(args);
      expect(result.shell).toBe('claude');
      expect(result.args).toEqual(args);
    });

    it('should handle empty arguments', () => {
      const result = buildPtySpawnArgs([]);
      expect(result.shell).toBe('claude');
      expect(result.args).toEqual([]);
    });
  });
});
