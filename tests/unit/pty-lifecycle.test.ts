import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { setupPtyLifecycle } from '../../src/pty-lifecycle.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createContext() {
  const ptyWrapper = new EventEmitter() as EventEmitter & {
    spawn: ReturnType<typeof vi.fn>;
  };
  ptyWrapper.spawn = vi.fn();

  return {
    ptyWrapper,
    autoExecutor: {
      hasPendingSessionLoad: vi.fn().mockReturnValue(false),
      handlePtyExitDuringSessionLoad: vi.fn().mockResolvedValue(undefined),
      isQueueActive: vi.fn().mockReturnValue(false),
      handlePtyCrashRecovery: vi.fn().mockResolvedValue(true),
    },
    conversationLogger: {
      getCurrentSessionId: vi.fn().mockReturnValue(null),
    },
    display: {
      showMessage: vi.fn(),
    },
    telegramNotifier: {
      notify: vi.fn(),
    },
    queueManager: {
      getLength: vi.fn().mockReturnValue(2),
    },
    batchReporter: null,
    cleanup: vi.fn(),
    getClaudeArgs: vi.fn().mockReturnValue(['--debug']),
    onExit: vi.fn(),
  };
}

describe('setupPtyLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should recover session load failure by restarting PTY without resume', async () => {
    const ctx = createContext();
    ctx.autoExecutor.hasPendingSessionLoad.mockReturnValue(true);

    setupPtyLifecycle(ctx);

    ctx.ptyWrapper.emit('exit', 2);
    await flushAsync();

    expect(ctx.autoExecutor.handlePtyExitDuringSessionLoad).toHaveBeenCalledTimes(1);
    expect(ctx.ptyWrapper.spawn).toHaveBeenCalledWith(['--debug']);
    expect(ctx.cleanup).not.toHaveBeenCalled();
    expect(ctx.onExit).not.toHaveBeenCalled();
  });

  it('should restart with --resume when PTY crashes during active queue execution', async () => {
    const ctx = createContext();
    ctx.autoExecutor.isQueueActive.mockReturnValue(true);
    ctx.conversationLogger.getCurrentSessionId.mockReturnValue('session-123');

    setupPtyLifecycle(ctx);

    ctx.ptyWrapper.emit('exit', 1);
    await flushAsync();

    expect(ctx.display.showMessage).toHaveBeenCalledWith('warning', '[Queue] Claude Code crashed. Recovering...');
    expect(ctx.autoExecutor.handlePtyCrashRecovery).toHaveBeenCalledTimes(1);
    expect(ctx.telegramNotifier.notify).toHaveBeenCalledWith('pty_crashed', {
      queueLength: 2,
      message: 'Resuming session...',
    });
    expect(ctx.ptyWrapper.spawn).toHaveBeenCalledWith(['--resume', 'session-123', '--debug']);
  });

  it('should show an error and exit on non-zero idle PTY exit', async () => {
    const ctx = createContext();

    setupPtyLifecycle(ctx);

    ctx.ptyWrapper.emit('exit', 1);
    await flushAsync();

    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', expect.any(String));
    expect(ctx.cleanup).toHaveBeenCalledTimes(1);
    expect(ctx.onExit).toHaveBeenCalledWith(1);
  });
});
