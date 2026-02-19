import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PtyWrapper } from '../../src/pty-wrapper.js';
import { QueueManager } from '../../src/queue-manager.js';
import { StateDetector } from '../../src/state-detector.js';
import { AutoExecutor } from '../../src/auto-executor.js';
import { Display } from '../../src/display.js';
import * as fs from 'node:fs/promises';
import * as pty from 'node-pty';

// Mock node-pty
vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock fs for queue manager tests
vi.mock('node:fs/promises');

// Mock cli-args
vi.mock('../../src/utils/cli-args.js', () => ({
  buildPtySpawnArgs: vi.fn(() => ({
    shell: 'mock-shell',
    args: ['mock-arg'],
  })),
}));

describe('Error Handling Integration', () => {
  let ptyWrapper: PtyWrapper;
  let queueManager: QueueManager;
  let stateDetector: StateDetector;
  let display: Display;
  let autoExecutor: AutoExecutor;
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
    vi.useFakeTimers();
    exitCallback = null;

    // Create mock PTY instance
    mockPtyInstance = {
      onData: vi.fn(),
      onExit: vi.fn((callback) => {
        exitCallback = callback;
      }),
      kill: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
    };

    vi.mocked(pty.spawn).mockReturnValue(mockPtyInstance as unknown as pty.IPty);

    // Initialize components
    ptyWrapper = new PtyWrapper();
    queueManager = new QueueManager('.test-queue');
    stateDetector = new StateDetector();
    display = new Display();

    // Mock display methods for verification
    vi.spyOn(display, 'showMessage').mockImplementation(() => {});
    vi.spyOn(display, 'setCurrentItem').mockImplementation(() => {});

    autoExecutor = new AutoExecutor({
      stateDetector,
      queueManager,
      ptyWrapper,
      display,
      getClaudeArgs: () => [],
    });

    // Initialize fs mock
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('PTY Unexpected Exit (AC 1)', () => {
    it('should log error when PTY exits with non-zero code', async () => {
      // Given
      const { logger } = await import('../../src/utils/logger.js');
      ptyWrapper.spawn([]);

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

    it('should emit exit event with correct code for error handling', () => {
      // Given
      ptyWrapper.spawn([]);
      const exitHandler = vi.fn();
      ptyWrapper.on('exit', exitHandler);

      // When
      if (exitCallback) {
        exitCallback({ exitCode: 137 }); // SIGKILL
      }

      // Then
      expect(exitHandler).toHaveBeenCalledWith(137, undefined);
    });

    it('should not log error for normal exit (code 0)', async () => {
      // Given
      const { logger } = await import('../../src/utils/logger.js');
      ptyWrapper.spawn([]);
      vi.mocked(logger.error).mockClear();

      // When
      if (exitCallback) {
        exitCallback({ exitCode: 0 });
      }

      // Then
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('Queue File I/O Errors (AC 2, 5)', () => {
    it('should emit file_read_error event on persistent read failure', async () => {
      // Given - use real timers for retry
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      const errorHandler = vi.fn();
      queueManager.on('file_read_error', errorHandler);

      // When
      await queueManager.reload();

      // Then
      expect(errorHandler).toHaveBeenCalledTimes(1);
    }, 10000);

    it('should continue operation after read failure (in-memory fallback)', async () => {
      // Given - use real timers
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // When
      await queueManager.reload();
      await queueManager.addItem('test');

      // Then - should have item in memory
      expect(queueManager.getItems()).toHaveLength(1);
    }, 10000);

    it('should emit file_write_error event on persistent write failure', async () => {
      // Given - use real timers
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Disk full'));
      const errorHandler = vi.fn();
      queueManager.on('file_write_error', errorHandler);

      // When
      await queueManager.addItem('test');

      // Then
      expect(errorHandler).toHaveBeenCalledTimes(1);
    }, 10000);

    it('should emit file_recovered event when file becomes accessible', async () => {
      // Given - use real timers
      vi.useRealTimers();

      // First fail
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      await queueManager.reload();

      // Then succeed
      vi.mocked(fs.readFile).mockResolvedValue('prompt1');
      const recoveredHandler = vi.fn();
      queueManager.on('file_recovered', recoveredHandler);

      // When
      await queueManager.reload();

      // Then
      expect(recoveredHandler).toHaveBeenCalledTimes(1);
    }, 10000);
  });

  describe('User-Friendly Messages (AC 4)', () => {
    it('should have user-friendly messages for all error codes', async () => {
      const { ErrorCode, getUserFriendlyMessage } = await import('../../src/types/errors.js');

      // All error codes should have messages
      const codes = Object.values(ErrorCode);
      for (const code of codes) {
        const message = getUserFriendlyMessage(code);
        expect(message).toBeTruthy();
        expect(message.length).toBeGreaterThan(0);
        // Should be in English (no Korean characters)
        expect(message).not.toMatch(/[\u3131-\uD79D]/);
      }
    });

    it('should display user-friendly message on PTY unexpected exit', async () => {
      // Given
      ptyWrapper.spawn([]);
      const showMessageSpy = display.showMessage as ReturnType<typeof vi.fn>;

      // Setup exit handler as in main.ts
      const { ErrorCode, getUserFriendlyMessage } = await import('../../src/types/errors.js');
      ptyWrapper.on('exit', (exitCode: number) => {
        if (exitCode !== 0) {
          display.showMessage('error', getUserFriendlyMessage(ErrorCode.PTY_UNEXPECTED_EXIT));
        }
      });

      // When
      if (exitCallback) {
        exitCallback({ exitCode: 1 });
      }

      // Then
      expect(showMessageSpy).toHaveBeenCalledWith(
        'error',
        'Claude Code exited unexpectedly. Shutting down safely.'
      );
    });
  });

  describe('Non-Critical Error Continuation (AC 5)', () => {
    it('should continue operation on queue file read failure', async () => {
      // Given - use real timers
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // When - operations should not throw
      await queueManager.reload();
      await queueManager.addItem('item1');
      await queueManager.addItem('item2');

      // Then - items should be in memory
      expect(queueManager.getItems()).toHaveLength(2);
    }, 10000);

    it('should continue detecting state during continuous output', async () => {
      // Given - analyzing output
      stateDetector.analyze('random 1\n');
      stateDetector.analyze('random 2\n');
      stateDetector.analyze('random 3\n');

      // When - continue analyzing (should not throw)
      stateDetector.analyze('more random\n');
      stateDetector.analyze('even more\n');

      // Then - state should be functioning
      expect(stateDetector.getState()).toBeTruthy();
      expect(stateDetector.getState().type).toBe('PROCESSING');

      // Advance timer to reach READY (requires 2 stability checks = 2 × 1500ms)
      await vi.advanceTimersByTimeAsync(3000);
      expect(stateDetector.getState().type).toBe('READY');
    });
  });
});
