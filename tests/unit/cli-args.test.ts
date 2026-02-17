import { describe, it, expect } from 'vitest';
import { collectClaudeArgs, buildPtySpawnArgs } from '../../src/utils/cli-args.js';

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
