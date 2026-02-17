import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPtySpawnArgs } from '../../src/utils/cli-args.js';

// Mock node-pty module
vi.mock('node-pty', () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
  })),
}));

describe('CLI Passthrough Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('PTY spawn arguments', () => {
    it('should pass arguments to PTY spawn (Windows)', () => {
      const result = buildPtySpawnArgs(['--help'], 'win32');
      expect(result.shell).toBe('cmd.exe');
      expect(result.args).toEqual(['/c', 'claude', '--help']);
    });

    it('should pass arguments to PTY spawn (Unix)', () => {
      const result = buildPtySpawnArgs(['--help'], 'linux');
      expect(result.shell).toBe('claude');
      expect(result.args).toEqual(['--help']);
    });

    it('should handle complex argument combinations on Windows', () => {
      const result = buildPtySpawnArgs(
        ['--dangerously-skip-permissions', 'test prompt', '--print'],
        'win32'
      );
      expect(result.args).toEqual([
        '/c',
        'claude',
        '--dangerously-skip-permissions',
        'test prompt',
        '--print',
      ]);
    });

    it('should handle complex argument combinations on Unix', () => {
      const result = buildPtySpawnArgs(
        ['--dangerously-skip-permissions', 'test prompt', '--print'],
        'darwin'
      );
      expect(result.args).toEqual([
        '--dangerously-skip-permissions',
        'test prompt',
        '--print',
      ]);
    });
  });

  describe('PtyWrapper integration', () => {
    it('should construct correct spawn command for Windows', async () => {
      const pty = await import('node-pty');
      const { PtyWrapper } = await import('../../src/pty-wrapper.js');

      // Mock process.platform for test
      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const wrapper = new PtyWrapper();
      wrapper.spawn(['--help']);

      expect(pty.spawn).toHaveBeenCalledWith(
        'cmd.exe',
        ['/c', 'claude', '--help'],
        expect.objectContaining({
          name: 'xterm-256color',
          cwd: process.cwd(),
        })
      );

      // Restore
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should preserve argument order in spawn call', async () => {
      const pty = await import('node-pty');
      const { PtyWrapper } = await import('../../src/pty-wrapper.js');

      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const wrapper = new PtyWrapper();
      const args = ['--dangerously-skip-permissions', 'hello world', '--print', '--model', 'sonnet'];
      wrapper.spawn(args);

      expect(pty.spawn).toHaveBeenCalledWith(
        'cmd.exe',
        ['/c', 'claude', ...args],
        expect.any(Object)
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });

    it('should handle empty arguments', async () => {
      const pty = await import('node-pty');
      const { PtyWrapper } = await import('../../src/pty-wrapper.js');

      const originalPlatform = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });

      const wrapper = new PtyWrapper();
      wrapper.spawn([]);

      expect(pty.spawn).toHaveBeenCalledWith(
        'cmd.exe',
        ['/c', 'claude'],
        expect.any(Object)
      );

      Object.defineProperty(process, 'platform', { value: originalPlatform });
    });
  });
});
