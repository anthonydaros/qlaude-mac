import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { PtyWrapper } from '../../src/pty-wrapper.js';
import * as pty from 'node-pty';
import { logger } from '../../src/utils/logger.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

// Mock cli-args
vi.mock('../../src/utils/cli-args.js', () => ({
  buildPtySpawnArgs: vi.fn((args: string[]) => ({
    shell: 'mock-shell',
    args: ['mock-arg', ...args],
  })),
}));

describe('PtyWrapper', () => {
  let ptyWrapper: PtyWrapper;
  let mockPtyInstance: {
    onData: ReturnType<typeof vi.fn>;
    onExit: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
  };
  let exitCallback: ((data: { exitCode: number; signal?: number }) => void) | null;

  beforeEach(() => {
    vi.clearAllMocks();
    exitCallback = null;

    // Create mock PTY instance
    mockPtyInstance = {
      onData: vi.fn((callback: (data: string) => void) => {
        // Store callback for later use if needed
      }),
      onExit: vi.fn((callback: (data: { exitCode: number; signal?: number }) => void) => {
        exitCallback = callback;
      }),
      kill: vi.fn(() => {
        // Simulate async exit event
        if (exitCallback) {
          setTimeout(() => exitCallback!({ exitCode: 0 }), 0);
        }
      }),
      write: vi.fn(),
      resize: vi.fn(),
    };

    vi.mocked(pty.spawn).mockReturnValue(mockPtyInstance as unknown as pty.IPty);

    ptyWrapper = new PtyWrapper();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('restart (AC 2, 6)', () => {
    it('should kill existing PTY and spawn new one', async () => {
      // Given
      const claudeArgs = ['--no-update'];
      ptyWrapper.spawn(claudeArgs);
      expect(ptyWrapper.isRunning()).toBe(true);

      // Clear mock calls from initial spawn
      vi.mocked(pty.spawn).mockClear();

      // When
      const restartPromise = ptyWrapper.restart(claudeArgs);

      // Simulate exit event
      ptyWrapper.emit('exit', 0, undefined);

      // Then
      await restartPromise;
      expect(mockPtyInstance.kill).toHaveBeenCalled();
      expect(pty.spawn).toHaveBeenCalledTimes(1);
    });

    it('should spawn directly if no PTY is running', async () => {
      // Given - ptyWrapper not spawned yet
      const claudeArgs = ['--no-update'];
      expect(ptyWrapper.isRunning()).toBe(false);

      // When
      await ptyWrapper.restart(claudeArgs);

      // Then
      expect(ptyWrapper.isRunning()).toBe(true);
      expect(pty.spawn).toHaveBeenCalledTimes(1);
    });

    it('should propagate spawn error', async () => {
      // Given
      const claudeArgs = ['--no-update'];
      const spawnError = new Error('Spawn failed');
      vi.mocked(pty.spawn).mockImplementation(() => {
        throw spawnError;
      });

      // When/Then
      await expect(ptyWrapper.restart(claudeArgs)).rejects.toThrow('Spawn failed');
    });

    it('should propagate spawn error after exit event', async () => {
      // Given
      const claudeArgs = ['--no-update'];

      // First spawn succeeds
      ptyWrapper.spawn(claudeArgs);

      // Clear mock calls and set up error for next spawn
      vi.mocked(pty.spawn).mockClear();
      const spawnError = new Error('Spawn failed after exit');
      vi.mocked(pty.spawn).mockImplementation(() => {
        throw spawnError;
      });

      // When
      const restartPromise = ptyWrapper.restart(claudeArgs);
      ptyWrapper.emit('exit', 0, undefined);

      // Then
      await expect(restartPromise).rejects.toThrow('Spawn failed after exit');
    });

    it('should handle PTY already terminated (isRunning false)', async () => {
      // Given - ptyWrapper was spawned but PTY is now null (terminated)
      const claudeArgs = ['--no-update'];
      // Don't spawn, simulate a state where PTY was killed externally
      expect(ptyWrapper.isRunning()).toBe(false);

      // When
      await ptyWrapper.restart(claudeArgs);

      // Then - should just spawn
      expect(pty.spawn).toHaveBeenCalledTimes(1);
      expect(ptyWrapper.isRunning()).toBe(true);
    });
  });

  describe('basic operations', () => {
    it('should report isRunning correctly', () => {
      // Given - not spawned
      expect(ptyWrapper.isRunning()).toBe(false);

      // When
      ptyWrapper.spawn(['--no-update']);

      // Then
      expect(ptyWrapper.isRunning()).toBe(true);
    });

    it('should write to PTY', () => {
      // Given
      ptyWrapper.spawn(['--no-update']);

      // When
      ptyWrapper.write('test input');

      // Then
      expect(mockPtyInstance.write).toHaveBeenCalledWith('test input');
    });

    it('should kill PTY', () => {
      // Given
      ptyWrapper.spawn(['--no-update']);
      expect(ptyWrapper.isRunning()).toBe(true);

      // When
      ptyWrapper.kill();

      // Then
      expect(mockPtyInstance.kill).toHaveBeenCalled();
      expect(ptyWrapper.isRunning()).toBe(false);
    });
  });

  describe('unexpected exit handling (AC 1)', () => {
    it('should log PtyError on non-zero exit code', () => {
      // Given
      ptyWrapper.spawn(['--no-update']);

      // When - simulate unexpected exit
      if (exitCallback) {
        exitCallback({ exitCode: 1 });
      }

      // Then
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          exitCode: 1,
        }),
        'PTY unexpected exit'
      );
    });

    it('should log PtyError with signal on unexpected exit', () => {
      // Given
      ptyWrapper.spawn(['--no-update']);

      // When - simulate exit with signal
      if (exitCallback) {
        exitCallback({ exitCode: 1, signal: 9 });
      }

      // Then
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          exitCode: 1,
          signal: 9,
        }),
        'PTY unexpected exit'
      );
    });

    it('should not log error on normal exit (exitCode 0)', () => {
      // Given
      ptyWrapper.spawn(['--no-update']);
      vi.mocked(logger.error).mockClear();

      // When - simulate normal exit
      if (exitCallback) {
        exitCallback({ exitCode: 0 });
      }

      // Then
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should emit exit event with correct exit code', () => {
      // Given
      ptyWrapper.spawn(['--no-update']);
      const exitHandler = vi.fn();
      ptyWrapper.on('exit', exitHandler);

      // When
      if (exitCallback) {
        exitCallback({ exitCode: 1, signal: 15 });
      }

      // Then
      expect(exitHandler).toHaveBeenCalledWith(1, 15);
    });

    it('should set pty to null on exit', () => {
      // Given
      ptyWrapper.spawn(['--no-update']);
      expect(ptyWrapper.isRunning()).toBe(true);

      // When
      if (exitCallback) {
        exitCallback({ exitCode: 1 });
      }

      // Then
      expect(ptyWrapper.isRunning()).toBe(false);
    });
  });
});
