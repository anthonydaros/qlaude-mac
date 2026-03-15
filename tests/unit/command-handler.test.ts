import { beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({
  saveSessionLabel: vi.fn(),
  getSessionLabel: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: registry.logger,
}));

vi.mock('../../src/utils/session-labels.js', () => ({
  saveSessionLabel: registry.saveSessionLabel,
  getSessionLabel: registry.getSessionLabel,
}));

import { createCommandHandler } from '../../src/command-handler.js';

function createContext() {
  const queueItems: Array<Record<string, any>> = [];

  return {
    queueItems,
    queueManager: {
      addItem: vi.fn(async (prompt: string, options?: Record<string, unknown>) => {
        queueItems.push({ prompt, ...options });
      }),
      removeLastItem: vi.fn(async () => queueItems.pop() ?? null),
      reload: vi.fn(async () => ({ fileFound: true, itemCount: queueItems.length, skippedLines: 0 })),
      getItems: vi.fn(() => [...queueItems]),
    },
    display: {
      showMessage: vi.fn(),
      toggle: vi.fn(() => true),
      updateStatusBar: vi.fn(),
      setPaused: vi.fn(),
    },
    autoExecutor: {
      stop: vi.fn(),
      start: vi.fn(),
    },
    ptyWrapper: {
      write: vi.fn(),
      resize: vi.fn(),
      restart: vi.fn(async () => undefined),
    },
    stateDetector: {
      reset: vi.fn(),
      forceReady: vi.fn(),
    },
    conversationLogger: {
      refreshSessionId: vi.fn(),
      getCurrentSessionId: vi.fn(() => 'session-1'),
    },
    terminalEmulator: {
      clear: vi.fn(),
    },
    setInHelpMode: vi.fn(),
    writeOutput: vi.fn(),
  };
}

describe('createCommandHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should handle queue additions, directives and queue removal flows', async () => {
    const ctx = createContext();
    const handler = createCommandHandler({
      ...ctx,
      getClaudeArgs: () => ['--json'],
    } as any);

    await handler(':add plain prompt');
    await handler(':add \\@literal');
    await handler(':add @new');
    await handler(':add @pause Need approval');
    await handler(':add @save snapshot');
    await handler(':add @load previous');
    await handler(':add @model sonnet');
    await handler(':add @delay 500');
    await handler(':add @delay nope');
    await handler(':add @save');
    await handler(':add @load');
    await handler(':add @model');
    await handler(':add @unknown branch');
    await handler(':drop');
    await handler(':drop');
    ctx.queueManager.removeLastItem.mockResolvedValueOnce(null);
    await handler(':drop');

    expect(ctx.queueManager.addItem).toHaveBeenCalledWith('plain prompt');
    expect(ctx.queueManager.addItem).toHaveBeenCalledWith('@literal');
    expect(ctx.queueManager.addItem).toHaveBeenCalledWith('', { isNewSession: true });
    expect(ctx.queueManager.addItem).toHaveBeenCalledWith('Need approval', { isBreakpoint: true });
    expect(ctx.queueManager.addItem).toHaveBeenCalledWith('', { labelSession: 'snapshot' });
    expect(ctx.queueManager.addItem).toHaveBeenCalledWith('', { loadSessionLabel: 'previous' });
    expect(ctx.queueManager.addItem).toHaveBeenCalledWith('/model sonnet', { modelName: 'sonnet' });
    expect(ctx.queueManager.addItem).toHaveBeenCalledWith('', { delayMs: 500 });
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Queue] Usage: :add @delay <ms>');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Queue] Usage: :add @save name');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Queue] Usage: :add @load name');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Queue] Usage: :add @model name');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('warning', '[Queue] Queue is empty');
  });

  it('should report add and remove failures and reject empty prompts', async () => {
    const ctx = createContext();
    ctx.queueManager.addItem.mockRejectedValueOnce(new Error('write failed'));
    ctx.queueManager.removeLastItem.mockRejectedValueOnce(new Error('remove failed'));
    const handler = createCommandHandler({
      ...ctx,
      getClaudeArgs: () => [],
    } as any);

    await handler(':add');
    await handler(':add broken');
    await handler(':drop');

    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Queue] Error: Empty prompt');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Queue] Error: Failed to add item');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Queue] Error: Failed to remove item');
    expect(registry.logger.error).toHaveBeenCalled();
  });

  it('should save and load sessions with success and failure branches', async () => {
    const ctx = createContext();
    registry.saveSessionLabel.mockReturnValueOnce(true).mockImplementationOnce(() => {
      throw new Error('save failed');
    });
    registry.getSessionLabel.mockReturnValueOnce('saved-session').mockReturnValueOnce(null);

    const handler = createCommandHandler({
      ...ctx,
      getClaudeArgs: () => ['--profile', 'dev'],
    } as any);

    await handler(':save release');
    ctx.conversationLogger.getCurrentSessionId.mockReturnValueOnce(null);
    await handler(':save missing');
    await handler(':save');
    await handler(':save broken');
    await handler(':load release');
    await handler(':load missing');
    await handler(':load');
    ctx.ptyWrapper.restart.mockRejectedValueOnce(new Error('restart failed'));
    registry.getSessionLabel.mockReturnValueOnce('saved-session');
    await handler(':load broken');

    expect(ctx.conversationLogger.refreshSessionId).toHaveBeenCalled();
    expect(registry.saveSessionLabel).toHaveBeenCalledWith('release', 'session-1');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('warning', '[Session] Label "release" overwritten');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Session] Error: No active session');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Session] Error: No label specified');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Session] Error: Failed to save');
    expect(ctx.ptyWrapper.restart).toHaveBeenCalledWith(['--resume', 'saved-session', '--profile', 'dev']);
    expect(ctx.terminalEmulator.clear).toHaveBeenCalled();
    expect(ctx.stateDetector.reset).toHaveBeenCalled();
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Session] Error: Label "missing" not found');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Session] Error: Failed to load session');
  });

  it('should reload, toggle status, pause, resume and switch models', async () => {
    const ctx = createContext();
    ctx.queueManager.reload
      .mockResolvedValueOnce({ fileFound: false, itemCount: 0, skippedLines: 0 })
      .mockResolvedValueOnce({ fileFound: true, itemCount: 3, skippedLines: 2 })
      .mockRejectedValueOnce(new Error('reload failed'));
    ctx.display.toggle.mockReturnValueOnce(true).mockReturnValueOnce(false);
    vi.useFakeTimers();

    const handler = createCommandHandler({
      ...ctx,
      getClaudeArgs: () => [],
    } as any);

    vi.useFakeTimers();
    await handler(':reload');
    await handler(':reload');
    await handler(':reload');
    await handler(':status');
    await handler(':status');
    await handler(':pause');
    await handler(':resume');
    const modelPromise = handler(':model opus');
    await vi.advanceTimersByTimeAsync(60);
    await modelPromise;
    await handler(':model');

    expect(ctx.display.showMessage).toHaveBeenCalledWith('warning', '[Queue] Queue file not found');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('info', '[Queue] Reloaded: 3 items');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('warning', '[Queue] Warning: 2 invalid lines skipped');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Queue] Error: Failed to reload queue');
    expect(ctx.display.updateStatusBar).toHaveBeenCalled();
    expect(ctx.ptyWrapper.resize).toHaveBeenCalledWith(80, 30);
    expect(ctx.autoExecutor.stop).toHaveBeenCalled();
    expect(ctx.autoExecutor.start).toHaveBeenCalled();
    expect(ctx.display.setPaused).toHaveBeenCalledWith(false);
    expect(ctx.stateDetector.forceReady).toHaveBeenCalled();
    expect(ctx.ptyWrapper.write).toHaveBeenCalledWith('/model opus');
    expect(ctx.ptyWrapper.write).toHaveBeenCalledWith('\r');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('error', '[Queue] Usage: :model name');
    vi.useRealTimers();
  });

  it('should render help, list queue contents, clear the queue and passthrough unknown input', async () => {
    const ctx = createContext();
    ctx.queueItems.push(
      { prompt: 'delay prompt', delayMs: 300 },
      { prompt: 'model prompt', modelName: 'sonnet' },
      { prompt: 'breakpoint prompt', isBreakpoint: true },
      { prompt: '', labelSession: 'checkpoint' },
      { prompt: '', loadSessionLabel: 'saved' },
      { prompt: 'multiline prompt', isNewSession: true, isMultiline: true },
    );

    const handler = createCommandHandler({
      ...ctx,
      getClaudeArgs: () => [],
    } as any);

    await handler(':help');
    await handler(':list');
    await handler(':clear');
    await handler(':list');
    await handler(':clear');
    await handler('hello claude');

    expect(ctx.writeOutput).toHaveBeenCalledWith(expect.stringContaining('Commands (: prefix, all immediate):'));
    expect(ctx.setInHelpMode).toHaveBeenCalledWith(true);
    expect(ctx.writeOutput).toHaveBeenCalledWith(expect.stringContaining('[Queue: 6 items]'));
    expect(ctx.writeOutput).toHaveBeenCalledWith(expect.stringContaining('[DELAY:300ms]'));
    expect(ctx.writeOutput).toHaveBeenCalledWith(expect.stringContaining('[MODEL:sonnet]'));
    expect(ctx.writeOutput).toHaveBeenCalledWith(expect.stringContaining('[PAUSE]'));
    expect(ctx.writeOutput).toHaveBeenCalledWith(expect.stringContaining('[SAVE:checkpoint]'));
    expect(ctx.writeOutput).toHaveBeenCalledWith(expect.stringContaining('[LOAD:saved]'));
    expect(ctx.writeOutput).toHaveBeenCalledWith(expect.stringContaining('[ML] [New Session] multiline prompt'));
    expect(ctx.queueManager.removeLastItem).toHaveBeenCalledTimes(6);
    expect(ctx.display.showMessage).toHaveBeenCalledWith('success', '[Queue] Cleared 6 items');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('info', '[Queue] Empty');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('info', '[Queue] Already empty');
    expect(ctx.ptyWrapper.write).toHaveBeenCalledWith('hello claude\r');
  });
});
