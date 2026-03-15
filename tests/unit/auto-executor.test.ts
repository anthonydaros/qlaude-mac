import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { AutoExecutor } from '../../src/auto-executor.js';
import { NEW_SESSION_MESSAGES } from '../../src/types/auto-executor.js';
import { getSessionLabel, saveSessionLabel } from '../../src/utils/session-labels.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/utils/session-labels.js', () => ({
  saveSessionLabel: vi.fn(),
  getSessionLabel: vi.fn(),
}));

// Mock object factories
function createMockStateDetector() {
  return Object.assign(new EventEmitter(), {
    isReadyForQueue: vi.fn().mockReturnValue(true),
    getState: vi.fn().mockReturnValue({ type: 'READY', timestamp: Date.now() }),
    reset: vi.fn(),
  });
}

function createMockQueueManager() {
  return Object.assign(new EventEmitter(), {
    popNextItem: vi.fn(),
    getItems: vi.fn().mockReturnValue([]),
    getLength: vi.fn().mockReturnValue(0),
    addItem: vi.fn().mockResolvedValue(undefined),
    prependItem: vi.fn().mockResolvedValue(undefined),
  });
}

function createMockPtyWrapper() {
  return {
    write: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
    restart: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockDisplay() {
  return {
    showMessage: vi.fn(),
    updateStatusBar: vi.fn(),
    setPaused: vi.fn(),
    setCurrentItem: vi.fn(),
  };
}

describe('AutoExecutor', () => {
  let autoExecutor: AutoExecutor;
  let mockStateDetector: ReturnType<typeof createMockStateDetector>;
  let mockQueueManager: ReturnType<typeof createMockQueueManager>;
  let mockPtyWrapper: ReturnType<typeof createMockPtyWrapper>;
  let mockDisplay: ReturnType<typeof createMockDisplay>;
  let mockConversationLogger: {
    logQueueItem: ReturnType<typeof vi.fn>;
    refreshSessionId: ReturnType<typeof vi.fn>;
    getCurrentSessionId: ReturnType<typeof vi.fn>;
  };
  let mockTerminalEmulator: {
    clear: ReturnType<typeof vi.fn>;
  };
  let mockTelegramNotifier: {
    notify: ReturnType<typeof vi.fn>;
  };

  const mockClaudeArgs = ['--no-update'];

  beforeEach(() => {
    vi.clearAllMocks();
    mockStateDetector = createMockStateDetector();
    mockQueueManager = createMockQueueManager();
    mockPtyWrapper = createMockPtyWrapper();
    mockDisplay = createMockDisplay();
    mockConversationLogger = {
      logQueueItem: vi.fn(),
      refreshSessionId: vi.fn(),
      getCurrentSessionId: vi.fn().mockReturnValue(null),
    };
    mockTerminalEmulator = {
      clear: vi.fn(),
    };
    mockTelegramNotifier = {
      notify: vi.fn(),
    };

    autoExecutor = new AutoExecutor({
      stateDetector: mockStateDetector as unknown as Parameters<typeof AutoExecutor>[0]['stateDetector'],
      queueManager: mockQueueManager as unknown as Parameters<typeof AutoExecutor>[0]['queueManager'],
      ptyWrapper: mockPtyWrapper as unknown as Parameters<typeof AutoExecutor>[0]['ptyWrapper'],
      display: mockDisplay as unknown as Parameters<typeof AutoExecutor>[0]['display'],
      getClaudeArgs: () => mockClaudeArgs,
      conversationLogger: mockConversationLogger as unknown as Parameters<typeof AutoExecutor>[0]['conversationLogger'],
      terminalEmulator: mockTerminalEmulator as unknown as Parameters<typeof AutoExecutor>[0]['terminalEmulator'],
      telegramNotifier: mockTelegramNotifier as unknown as Parameters<typeof AutoExecutor>[0]['telegramNotifier'],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('READY state handling', () => {
    it('should pause and emit spinner_detected when READY has spinner metadata', async () => {
      mockQueueManager.getLength.mockReturnValue(2);
      const spinnerHandler = vi.fn();
      autoExecutor.on('spinner_detected', spinnerHandler);

      mockStateDetector.emit('state_change', {
        type: 'READY',
        timestamp: Date.now(),
        metadata: { hasSpinner: true },
      });

      await vi.waitFor(() => expect(spinnerHandler).toHaveBeenCalledTimes(1));
      expect(mockQueueManager.popNextItem).not.toHaveBeenCalled();
      expect(mockDisplay.showMessage).toHaveBeenCalledWith(
        'warning',
        '[Queue] Spinner detected - pausing for safety. Use :resume to continue.'
      );
    });

    it('should ignore spinner metadata when queue is empty', async () => {
      mockQueueManager.getLength.mockReturnValue(0);

      mockStateDetector.emit('state_change', {
        type: 'READY',
        timestamp: Date.now(),
        metadata: { hasSpinner: true },
      });

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockDisplay.showMessage).not.toHaveBeenCalled();
      expect(mockQueueManager.popNextItem).not.toHaveBeenCalled();
    });

    it('should execute next item when READY state is detected (AC 1)', async () => {
      // Given
      const item = { prompt: 'test prompt', isNewSession: false };
      mockQueueManager.popNextItem.mockResolvedValue(item);

      // When
      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      // Wait for Enter key (sent after 50ms delay)
      await vi.waitFor(() => expect(mockPtyWrapper.write).toHaveBeenCalledWith('\r'));

      // Then
      expect(mockQueueManager.popNextItem).toHaveBeenCalled();
      expect(mockPtyWrapper.write).toHaveBeenCalledWith('test prompt');
      expect(mockPtyWrapper.write).toHaveBeenCalledWith('\r');
    });

    it('should execute first (oldest) item in queue (AC 2)', async () => {
      // Given
      const item = { prompt: 'first item', isNewSession: false };
      mockQueueManager.popNextItem.mockResolvedValue(item);

      // When
      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      // Wait for Enter key (sent after 50ms delay)
      await vi.waitFor(() => expect(mockPtyWrapper.write).toHaveBeenCalledWith('\r'));

      // Then
      expect(mockQueueManager.popNextItem).toHaveBeenCalled(); // popNextItem returns first item
      expect(mockPtyWrapper.write).toHaveBeenCalledWith('first item');
      expect(mockPtyWrapper.write).toHaveBeenCalledWith('\r');
    });

    it('should set current item on display before execution (AC 3)', async () => {
      // Given
      const item = { prompt: 'test prompt', isNewSession: false };
      mockQueueManager.popNextItem.mockResolvedValue(item);

      // When
      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      await vi.waitFor(() => expect(mockDisplay.setCurrentItem).toHaveBeenCalled());

      // Then
      expect(mockDisplay.setCurrentItem).toHaveBeenCalledWith(item);
    });

    it('should set current item on display for persistent visibility', async () => {
      // Given
      const item = { prompt: 'test prompt', isNewSession: false };
      mockQueueManager.popNextItem.mockResolvedValue(item);

      // When
      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      await vi.waitFor(() => expect(mockDisplay.setCurrentItem).toHaveBeenCalled());

      // Then
      expect(mockDisplay.setCurrentItem).toHaveBeenCalledWith(item);
    });
  });

  describe('Queue item removal', () => {
    it('should remove executed item from queue (AC 4)', async () => {
      // Given
      const item = { prompt: 'test prompt', isNewSession: false };
      mockQueueManager.popNextItem.mockResolvedValue(item);

      // When
      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      await vi.waitFor(() => expect(mockQueueManager.popNextItem).toHaveBeenCalled());

      // Then
      // popNextItem removes the item from queue automatically
      expect(mockQueueManager.popNextItem).toHaveBeenCalledTimes(1);
    });
  });

  describe('Empty queue handling', () => {
    it('should stop execution when queue is empty (AC 6)', async () => {
      // Given
      mockQueueManager.popNextItem.mockResolvedValue(null);

      // When
      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      await vi.waitFor(() => expect(mockQueueManager.popNextItem).toHaveBeenCalled());

      // Then
      expect(mockPtyWrapper.write).not.toHaveBeenCalled();
      expect(mockDisplay.showMessage).not.toHaveBeenCalled();
    });
  });

  describe('Enabled flag', () => {
    it('should not execute when disabled', () => {
      // Given
      const item = { prompt: 'test prompt', isNewSession: false };
      mockQueueManager.popNextItem.mockResolvedValue(item);
      autoExecutor.stop();

      // When
      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });

      // Then
      expect(mockQueueManager.popNextItem).not.toHaveBeenCalled();
      expect(mockPtyWrapper.write).not.toHaveBeenCalled();
    });

    it('should resume execution when re-enabled', async () => {
      // Given
      const item = { prompt: 'test prompt', isNewSession: false };
      mockQueueManager.popNextItem.mockResolvedValue(item);
      autoExecutor.stop();
      autoExecutor.start();

      // When
      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      await vi.waitFor(() => expect(mockPtyWrapper.write).toHaveBeenCalled());

      // Then
      expect(mockQueueManager.popNextItem).toHaveBeenCalled();
    });

    it('should return correct enabled state', () => {
      // Given - initially enabled
      expect(autoExecutor.isEnabled()).toBe(true);

      // When
      autoExecutor.stop();

      // Then
      expect(autoExecutor.isEnabled()).toBe(false);

      // When
      autoExecutor.start();

      // Then
      expect(autoExecutor.isEnabled()).toBe(true);
    });
  });

  describe('Non-READY states', () => {
    it('should not execute on PROCESSING state', () => {
      // When
      mockStateDetector.emit('state_change', { type: 'PROCESSING', timestamp: Date.now() });

      // Then
      expect(mockQueueManager.popNextItem).not.toHaveBeenCalled();
    });

    it('should not execute on SELECTION_PROMPT state', () => {
      // When
      mockStateDetector.emit('state_change', { type: 'SELECTION_PROMPT', timestamp: Date.now() });

      // Then
      expect(mockQueueManager.popNextItem).not.toHaveBeenCalled();
    });

    it('should not execute on INTERRUPTED state', () => {
      // When
      mockStateDetector.emit('state_change', { type: 'INTERRUPTED', timestamp: Date.now() });

      // Then
      expect(mockQueueManager.popNextItem).not.toHaveBeenCalled();
    });
  });

  describe('Edge case: PTY not running', () => {
    it('should handle PTY not running gracefully', async () => {
      // Given
      const item = { prompt: 'test prompt', isNewSession: false };
      mockQueueManager.popNextItem.mockResolvedValue(item);
      mockPtyWrapper.isRunning.mockReturnValue(false);

      // When
      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });

      // Then - should not attempt to write if PTY is not running
      // Need to wait a tick for async handling
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(mockPtyWrapper.write).not.toHaveBeenCalled();
      expect(mockQueueManager.popNextItem).not.toHaveBeenCalled();
    });
  });

  describe('Edge case: Queue file I/O error', () => {
    it('should handle queue file I/O error gracefully', async () => {
      // Given
      mockQueueManager.popNextItem.mockRejectedValue(new Error('EACCES: permission denied'));

      // When
      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });

      // Then - should not crash, error should be logged
      await vi.waitFor(() => expect(mockQueueManager.popNextItem).toHaveBeenCalled());
      expect(mockPtyWrapper.write).not.toHaveBeenCalled();
    });
  });

  describe('Event emission', () => {
    it('should emit executed event after successful execution', async () => {
      // Given
      const item = { prompt: 'test prompt', isNewSession: false };
      mockQueueManager.popNextItem.mockResolvedValue(item);
      const executedHandler = vi.fn();
      autoExecutor.on('executed', executedHandler);

      // When
      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      await vi.waitFor(() => expect(executedHandler).toHaveBeenCalled());

      // Then
      expect(executedHandler).toHaveBeenCalledWith(item);
    });

    it('should not emit executed event when queue is empty', async () => {
      // Given
      mockQueueManager.popNextItem.mockResolvedValue(null);
      const executedHandler = vi.fn();
      autoExecutor.on('executed', executedHandler);

      // When
      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      await vi.waitFor(() => expect(mockQueueManager.popNextItem).toHaveBeenCalled());

      // Then
      expect(executedHandler).not.toHaveBeenCalled();
    });

    it('should emit queue_started and queue_completed with Telegram notifications', async () => {
      const item = { prompt: 'first queued prompt', isNewSession: false };
      const startedHandler = vi.fn();
      const completedHandler = vi.fn();
      mockQueueManager.getLength.mockReturnValue(0);
      mockQueueManager.popNextItem
        .mockResolvedValueOnce(item)
        .mockResolvedValueOnce(null);
      autoExecutor.on('queue_started', startedHandler);
      autoExecutor.on('queue_completed', completedHandler);

      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      await vi.waitFor(() => expect(startedHandler).toHaveBeenCalledTimes(1));
      expect(autoExecutor.isQueueActive()).toBe(true);
      expect(mockTelegramNotifier.notify).toHaveBeenCalledWith('queue_started', { queueLength: 1 });

      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      await vi.waitFor(() => expect(completedHandler).toHaveBeenCalledTimes(1));
      expect(autoExecutor.isQueueActive()).toBe(false);
      expect(mockTelegramNotifier.notify).toHaveBeenCalledWith('queue_completed');
    });
  });

  describe('New Session Handling', () => {
    describe('handleNewSession (AC 1, 2, 3, 4, 6)', () => {
      it('should call ptyWrapper.restart when isNewSession is true', async () => {
        // Given
        const item = { prompt: 'new session prompt', isNewSession: true };
        mockQueueManager.popNextItem.mockResolvedValue(item);

        // When
        mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
        await vi.waitFor(() => expect(mockPtyWrapper.restart).toHaveBeenCalled());

        // Then
        expect(mockPtyWrapper.restart).toHaveBeenCalledWith(mockClaudeArgs);
        expect(mockPtyWrapper.write).not.toHaveBeenCalled(); // prompt executed after restart via pending
      });

      it('should show starting new session message (AC 4)', async () => {
        // Given
        const item = { prompt: 'new session prompt', isNewSession: true };
        mockQueueManager.popNextItem.mockResolvedValue(item);

        // When
        mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
        await vi.waitFor(() => expect(mockDisplay.showMessage).toHaveBeenCalled());

        // Then
        expect(mockDisplay.showMessage).toHaveBeenCalledWith(
          'info',
          NEW_SESSION_MESSAGES.STARTING
        );
      });

      it('should emit session_restart event (AC 4)', async () => {
        // Given
        const item = { prompt: 'new session prompt', isNewSession: true };
        mockQueueManager.popNextItem.mockResolvedValue(item);
        const sessionRestartHandler = vi.fn();
        autoExecutor.on('session_restart', sessionRestartHandler);

        // When
        mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
        await vi.waitFor(() => expect(sessionRestartHandler).toHaveBeenCalled());

        // Then
        expect(sessionRestartHandler).toHaveBeenCalledWith(item);
      });

      it('should execute prompt in new session after READY state (AC 3)', async () => {
        // Given
        const item = { prompt: 'new session prompt', isNewSession: true };
        mockQueueManager.popNextItem.mockResolvedValueOnce(item).mockResolvedValue(null);

        // When - First READY triggers new session
        mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
        await vi.waitFor(() => expect(mockPtyWrapper.restart).toHaveBeenCalled());

        // Then - Second READY (after new session) executes the prompt via pendingNewSessionItem
        mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
        // Wait for Enter key (sent after 50ms delay)
        await vi.waitFor(() => expect(mockPtyWrapper.write).toHaveBeenCalledWith('\r'));

        expect(mockPtyWrapper.write).toHaveBeenCalledWith('new session prompt');
        expect(mockPtyWrapper.write).toHaveBeenCalledWith('\r');
      });

      it('should skip blank pending new session prompts', async () => {
        const pendingItem = { prompt: '   ', isNewSession: true };
        (autoExecutor as unknown as { pendingNewSessionItem: typeof pendingItem | null }).pendingNewSessionItem = pendingItem;
        (autoExecutor as unknown as { currentExecutingItem: typeof pendingItem | null }).currentExecutingItem = pendingItem;

        mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(mockPtyWrapper.write).not.toHaveBeenCalled();
        expect(mockQueueManager.popNextItem).not.toHaveBeenCalled();
        expect((autoExecutor as unknown as { currentExecutingItem: typeof pendingItem | null }).currentExecutingItem).toBeNull();
      });

      it('should prioritize pendingNewSessionItem over queue items (AC 3)', async () => {
        // Given - set pendingNewSessionItem directly
        const pendingItem = { prompt: 'pending prompt', isNewSession: true };
        const queueItem = { prompt: 'queue prompt', isNewSession: false };

        // Simulate state where pendingNewSessionItem is set
        (autoExecutor as unknown as { pendingNewSessionItem: typeof pendingItem })['pendingNewSessionItem'] = pendingItem;
        mockQueueManager.popNextItem.mockResolvedValue(queueItem);

        // When - READY state triggers
        mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
        // Wait for Enter key (sent after 50ms delay)
        await vi.waitFor(() => expect(mockPtyWrapper.write).toHaveBeenCalledWith('\r'));

        // Then - pendingNewSessionItem should be executed, not queue item
        expect(mockPtyWrapper.write).toHaveBeenCalledWith('pending prompt');
        expect(mockPtyWrapper.write).toHaveBeenCalledWith('\r');
        expect(mockQueueManager.popNextItem).not.toHaveBeenCalled();
        expect((autoExecutor as unknown as { pendingNewSessionItem: typeof pendingItem | null })['pendingNewSessionItem']).toBeNull();
      });

      it('should clear currentExecutingItem after pending new session prompt execution', async () => {
        // Given
        const pendingItem = { prompt: 'pending prompt', isNewSession: true };
        (autoExecutor as unknown as { pendingNewSessionItem: typeof pendingItem })['pendingNewSessionItem'] = pendingItem;
        (autoExecutor as unknown as { currentExecutingItem: typeof pendingItem | null })['currentExecutingItem'] = pendingItem;

        // When
        mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
        await vi.waitFor(() => expect(mockPtyWrapper.write).toHaveBeenCalledWith('\r'));

        // Then
        expect((autoExecutor as unknown as { currentExecutingItem: typeof pendingItem | null })['currentExecutingItem']).toBeNull();
      });

      it('should retry once on restart failure (AC 6)', async () => {
        // Given
        const item = { prompt: 'new session prompt', isNewSession: true };
        mockQueueManager.popNextItem.mockResolvedValue(item);
        mockPtyWrapper.restart
          .mockRejectedValueOnce(new Error('First attempt failed'))
          .mockResolvedValueOnce(undefined);

        vi.useFakeTimers();

        // When
        mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });

        // Fast-forward through retry delay
        await vi.advanceTimersByTimeAsync(1000);

        // Then - should have retried and succeeded
        expect(mockPtyWrapper.restart).toHaveBeenCalledTimes(2);
        expect((autoExecutor as unknown as { pendingNewSessionItem: typeof item | null })['pendingNewSessionItem']).toEqual(item);
      });

      it('should re-add item to queue after max retries exceeded', async () => {
        // Given
        const item = { prompt: 'new session prompt', isNewSession: true };
        mockQueueManager.popNextItem.mockResolvedValue(item);
        mockPtyWrapper.restart.mockRejectedValue(new Error('Restart failed'));

        vi.useFakeTimers();

        // When
        mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });

        // Fast-forward through all retries
        await vi.advanceTimersByTimeAsync(2000);

        // Then - should have re-added item to queue front with preserved metadata
        expect(mockQueueManager.prependItem).toHaveBeenCalledWith(
          item.prompt,
          expect.objectContaining({ isNewSession: true })
        );
        expect(mockDisplay.showMessage).toHaveBeenCalledWith(
          'error',
          NEW_SESSION_MESSAGES.FAILED_MAX_RETRIES
        );
        expect(mockTelegramNotifier.notify).toHaveBeenCalledWith('task_failed', {
          queueLength: 0,
          message: NEW_SESSION_MESSAGES.FAILED,
        });
        expect(mockTerminalEmulator.clear).toHaveBeenCalledTimes(1);
      });

      it('should pause auto-execution after max retries to prevent retry loops', async () => {
        // Given
        const item = { prompt: 'new session prompt', isNewSession: true };
        mockQueueManager.popNextItem.mockResolvedValue(item);
        mockPtyWrapper.restart.mockRejectedValue(new Error('Restart failed'));

        vi.useFakeTimers();

        // When
        mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });

        // Fast-forward through all retries
        await vi.advanceTimersByTimeAsync(2000);

        // Then
        expect(autoExecutor.isEnabled()).toBe(false);
      });
    });
  });

  describe('Safety Guards', () => {
    describe('Paused message on blocking states (AC 5)', () => {
      it('should show paused message when SELECTION_PROMPT detected with queued items', async () => {
        // Given
        mockQueueManager.getLength.mockReturnValue(1);

        // When
        mockStateDetector.emit('state_change', { type: 'SELECTION_PROMPT', timestamp: Date.now() });
        await vi.waitFor(() => expect(mockDisplay.showMessage).toHaveBeenCalled());

        // Then
        expect(mockDisplay.showMessage).toHaveBeenCalledWith(
          'warning',
          '[Queue] Paused (1 item) - waiting for user input'
        );
      });

      it('should show paused message when SELECTION_PROMPT detected with queued items', async () => {
        // Given
        mockQueueManager.getLength.mockReturnValue(2);

        // When
        mockStateDetector.emit('state_change', { type: 'SELECTION_PROMPT', timestamp: Date.now() });
        await vi.waitFor(() => expect(mockDisplay.showMessage).toHaveBeenCalled());

        // Then
        expect(mockDisplay.showMessage).toHaveBeenCalledWith(
          'warning',
          '[Queue] Paused (2 items) - waiting for user input'
        );
      });

      it('should NOT show paused message when INTERRUPTED detected (not a blocking state)', async () => {
        // Given - INTERRUPTED is no longer a blocking state (high false positive rate)
        mockQueueManager.getLength.mockReturnValue(1);

        // When
        mockStateDetector.emit('state_change', { type: 'INTERRUPTED', timestamp: Date.now() });

        // Small delay to ensure handler completes
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Then - no pause message since INTERRUPTED is not blocking
        expect(mockDisplay.showMessage).not.toHaveBeenCalled();
      });

      it('should NOT show paused message when queue is empty', async () => {
        // Given
        mockQueueManager.getLength.mockReturnValue(0);

        // When
        mockStateDetector.emit('state_change', { type: 'SELECTION_PROMPT', timestamp: Date.now() });

        // Small delay to ensure handler completes
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Then
        expect(mockDisplay.showMessage).not.toHaveBeenCalled();
      });

      it('should NOT show paused message on PROCESSING state', async () => {
        // Given
        mockQueueManager.getLength.mockReturnValue(1);

        // When
        mockStateDetector.emit('state_change', { type: 'PROCESSING', timestamp: Date.now() });

        // Small delay
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Then
        expect(mockDisplay.showMessage).not.toHaveBeenCalled();
      });

      it('should NOT show paused message when disabled', async () => {
        // Given
        mockQueueManager.getLength.mockReturnValue(1);
        autoExecutor.stop();

        // When
        mockStateDetector.emit('state_change', { type: 'SELECTION_PROMPT', timestamp: Date.now() });

        // Small delay
        await new Promise((resolve) => setTimeout(resolve, 10));

        // Then
        expect(mockDisplay.showMessage).not.toHaveBeenCalled();
      });
    });

    describe('Paused event emission (AC 5)', () => {
      it('should emit paused event with state type', async () => {
        // Given
        mockQueueManager.getLength.mockReturnValue(1);
        const pausedHandler = vi.fn();
        autoExecutor.on('paused', pausedHandler);

        // When
        mockStateDetector.emit('state_change', { type: 'SELECTION_PROMPT', timestamp: Date.now() });
        await vi.waitFor(() => expect(pausedHandler).toHaveBeenCalled());

        // Then
        expect(pausedHandler).toHaveBeenCalledWith('SELECTION_PROMPT');
      });
    });

    describe('Resume after blocking state (AC 4)', () => {
      it('should resume execution when READY state follows blocking state', async () => {
        // Given
        const item = { prompt: 'resume test', isNewSession: false };
        mockQueueManager.popNextItem.mockResolvedValue(item);
        mockQueueManager.getLength.mockReturnValue(1);

        // When - first blocking state
        mockStateDetector.emit('state_change', { type: 'SELECTION_PROMPT', timestamp: Date.now() });
        await vi.waitFor(() => expect(mockDisplay.showMessage).toHaveBeenCalledWith('warning', expect.any(String)));

        // Clear mocks and emit READY
        mockDisplay.showMessage.mockClear();
        mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
        // Wait for Enter key (sent after 50ms delay)
        await vi.waitFor(() => expect(mockPtyWrapper.write).toHaveBeenCalledWith('\r'));

        // Then
        expect(mockPtyWrapper.write).toHaveBeenCalledWith('resume test');
        expect(mockPtyWrapper.write).toHaveBeenCalledWith('\r');
        expect(mockDisplay.setCurrentItem).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'resume test' }));
      });
    });
  });

  describe('Configuration', () => {
    it('should respect initial enabled config', () => {
      // Given
      const disabledExecutor = new AutoExecutor(
        {
          stateDetector: mockStateDetector as unknown as Parameters<typeof AutoExecutor>[0]['stateDetector'],
          queueManager: mockQueueManager as unknown as Parameters<typeof AutoExecutor>[0]['queueManager'],
          ptyWrapper: mockPtyWrapper as unknown as Parameters<typeof AutoExecutor>[0]['ptyWrapper'],
          display: mockDisplay as unknown as Parameters<typeof AutoExecutor>[0]['display'],
          getClaudeArgs: () => mockClaudeArgs,
        },
        { enabled: false }
      );

      // Then
      expect(disabledExecutor.isEnabled()).toBe(false);
    });

    it('should default to enabled when no config provided', () => {
      // Given - autoExecutor created in beforeEach without config

      // Then
      expect(autoExecutor.isEnabled()).toBe(true);
    });
  });

  describe('Model switch handling', () => {
    it('should set current item on display for model switch', async () => {
      const item = { prompt: '/model opus', isNewSession: false, modelName: 'opus' };
      mockQueueManager.popNextItem.mockResolvedValue(item);

      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      await vi.waitFor(() => expect(mockDisplay.setCurrentItem).toHaveBeenCalled());

      expect(mockDisplay.setCurrentItem).toHaveBeenCalledWith(item);
    });

    it('should send /model command to PTY', async () => {
      const item = { prompt: '/model opus', isNewSession: false, modelName: 'opus' };
      mockQueueManager.popNextItem.mockResolvedValue(item);

      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      await vi.waitFor(() => expect(mockPtyWrapper.write).toHaveBeenCalled());

      expect(mockPtyWrapper.write).toHaveBeenCalledWith('/model opus');
    });

  });

  describe('Delay handling', () => {
    it('should show delay message and not write to PTY', async () => {
      const item = { prompt: '', isNewSession: false, delayMs: 100 };
      mockQueueManager.popNextItem
        .mockResolvedValueOnce(item)
        .mockResolvedValueOnce(null);

      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });
      await vi.waitFor(() => expect(mockDisplay.showMessage).toHaveBeenCalled());

      expect(mockDisplay.showMessage).toHaveBeenCalledWith(
        'info',
        '[Queue] Waiting 100ms...'
      );
      // PTY should not be written to for delay items
      expect(mockPtyWrapper.write).not.toHaveBeenCalled();
    });
  });

  describe('Failure and recovery handling', () => {
    it('should prepend failed task, pause queue and notify integrations', async () => {
      const item = { prompt: 'recover me', isNewSession: false, isMultiline: true };
      const failedHandler = vi.fn();
      mockQueueManager.getLength.mockReturnValue(1);
      autoExecutor.on('task_failed', failedHandler);
      (autoExecutor as unknown as { currentExecutingItem: typeof item | null }).currentExecutingItem = item;

      mockStateDetector.emit('state_change', {
        type: 'TASK_FAILED',
        timestamp: Date.now(),
        metadata: { failureReason: 'Rate limit' },
      });

      await vi.waitFor(() => expect(failedHandler).toHaveBeenCalledWith('Rate limit'));
      expect(mockQueueManager.prependItem).toHaveBeenCalledWith(
        'recover me',
        expect.objectContaining({ isMultiline: true })
      );
      expect(mockDisplay.setCurrentItem).toHaveBeenCalledWith(null);
      expect(mockDisplay.setPaused).toHaveBeenCalledWith(true);
      expect(mockTelegramNotifier.notify).toHaveBeenCalledWith('task_failed', {
        queueLength: 1,
        message: 'Rate limit',
      });
      expect(mockTerminalEmulator.clear).toHaveBeenCalled();
      expect(autoExecutor.isEnabled()).toBe(false);
    });

    it('should pause on breakpoint items and notify Telegram', async () => {
      const item = { prompt: 'review manually', isBreakpoint: true };
      mockQueueManager.popNextItem.mockResolvedValue(item);
      mockQueueManager.getLength.mockReturnValue(4);

      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });

      await vi.waitFor(() => expect(mockDisplay.setPaused).toHaveBeenCalledWith(true));
      expect(mockPtyWrapper.write).not.toHaveBeenCalled();
      expect(mockDisplay.showMessage).toHaveBeenCalledWith('info', '[Queue] Breakpoint: "review manually"');
      expect(mockDisplay.showMessage).toHaveBeenCalledWith(
        'warning',
        '[Queue] Auto-execution paused. Use :resume to continue.'
      );
      expect(mockTelegramNotifier.notify).toHaveBeenCalledWith('breakpoint', {
        queueLength: 4,
        message: 'review manually',
      });
      expect(mockTerminalEmulator.clear).toHaveBeenCalled();
      expect(autoExecutor.isEnabled()).toBe(false);
    });

    it('should label the current session and reset the detector without writing to PTY', async () => {
      const item = { prompt: '', labelSession: 'release' };
      mockQueueManager.popNextItem.mockResolvedValue(item);
      mockConversationLogger.getCurrentSessionId.mockReturnValue('session-42');
      vi.mocked(saveSessionLabel).mockReturnValue(true);

      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });

      await vi.waitFor(() => expect(saveSessionLabel).toHaveBeenCalledWith('release', 'session-42'));
      expect(mockConversationLogger.refreshSessionId).toHaveBeenCalledTimes(1);
      expect(mockDisplay.showMessage).toHaveBeenCalledWith('warning', '[Queue] Label "release" overwritten');
      expect(mockDisplay.showMessage).toHaveBeenCalledWith('success', '[Queue] Session labeled: "release"');
      expect(mockStateDetector.reset).toHaveBeenCalledTimes(1);
      expect(mockPtyWrapper.write).not.toHaveBeenCalled();
    });

    it('should fail when a session label cannot be resolved at execution time', async () => {
      const item = { prompt: 'resume work', loadSessionLabel: 'missing' };
      mockQueueManager.popNextItem.mockResolvedValue(item);
      mockQueueManager.getLength.mockReturnValue(2);
      vi.mocked(getSessionLabel).mockReturnValue(null);

      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });

      await vi.waitFor(() => expect(mockQueueManager.prependItem).toHaveBeenCalledWith(
        'resume work',
        expect.objectContaining({ loadSessionLabel: 'missing' })
      ));
      expect(mockTelegramNotifier.notify).toHaveBeenCalledWith('task_failed', {
        queueLength: 2,
        message: 'Session not found: "missing"',
      });
      expect(autoExecutor.isEnabled()).toBe(false);
    });

    it('should resume a labeled session using --resume args', async () => {
      const item = { prompt: 'continue', loadSessionLabel: 'saved' };
      mockQueueManager.popNextItem.mockResolvedValue(item);
      vi.mocked(getSessionLabel).mockReturnValue('session-resume-1');

      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });

      await vi.waitFor(() => expect(mockPtyWrapper.restart).toHaveBeenCalledWith([
        '--resume',
        'session-resume-1',
        ...mockClaudeArgs,
      ]));
      expect(mockDisplay.showMessage).toHaveBeenCalledWith('info', '[Queue] Loading session: "saved"');
    });

    it('should skip empty prompts popped from the queue', async () => {
      mockQueueManager.popNextItem.mockResolvedValue({ prompt: '   ', isNewSession: false });

      mockStateDetector.emit('state_change', { type: 'READY', timestamp: Date.now() });

      await vi.waitFor(() => expect(mockQueueManager.popNextItem).toHaveBeenCalled());
      expect(mockPtyWrapper.write).not.toHaveBeenCalled();
    });

    it('should report pending session loads and recover from PTY exit during session load', async () => {
      const item = { prompt: 'resume task', resumeSessionId: 'session-10', loadSessionLabel: 'saved' };
      (autoExecutor as unknown as { currentExecutingItem: typeof item | null }).currentExecutingItem = item;
      mockQueueManager.getLength.mockReturnValue(3);

      expect(autoExecutor.hasPendingSessionLoad()).toBe(true);

      await autoExecutor.handlePtyExitDuringSessionLoad();

      expect(mockQueueManager.prependItem).toHaveBeenCalledWith(
        'resume task',
        expect.objectContaining({ resumeSessionId: 'session-10', loadSessionLabel: 'saved' })
      );
      expect(mockDisplay.setCurrentItem).toHaveBeenCalledWith(null);
      expect(mockDisplay.setPaused).toHaveBeenCalledWith(true);
      expect(mockDisplay.showMessage).toHaveBeenCalledWith(
        'error',
        '[Queue] Session load failed ("saved"). Auto-execution stopped (3 items remaining).'
      );
      expect(mockTelegramNotifier.notify).toHaveBeenCalledWith('task_failed', {
        queueLength: 3,
        message: 'Session load failed: "saved"',
      });
      expect(mockTerminalEmulator.clear).toHaveBeenCalled();
      expect(autoExecutor.hasPendingSessionLoad()).toBe(false);
    });

    it('should requeue crashed items, reset state detector and stop after repeated crashes', async () => {
      const currentItem = { prompt: 'active task', isNewSession: false };
      const pendingItem = { prompt: 'pending task', resumeSessionId: 'resume-2' };
      (autoExecutor as unknown as { currentExecutingItem: typeof currentItem | null }).currentExecutingItem = currentItem;
      (autoExecutor as unknown as { pendingNewSessionItem: typeof pendingItem | null }).pendingNewSessionItem = pendingItem;

      await expect(autoExecutor.handlePtyCrashRecovery()).resolves.toBe(true);
      expect(mockQueueManager.prependItem).toHaveBeenNthCalledWith(
        1,
        'pending task',
        expect.objectContaining({ resumeSessionId: 'resume-2' })
      );
      expect(mockQueueManager.prependItem).toHaveBeenNthCalledWith(
        2,
        'active task',
        expect.objectContaining({ isNewSession: false })
      );
      expect(mockStateDetector.reset).toHaveBeenCalled();
      expect(mockTerminalEmulator.clear).toHaveBeenCalled();

      mockQueueManager.prependItem.mockClear();
      mockDisplay.showMessage.mockClear();
      mockDisplay.setPaused.mockClear();
      mockTelegramNotifier.notify.mockClear();

      for (let i = 0; i < 2; i++) {
        (autoExecutor as unknown as { currentExecutingItem: typeof currentItem | null }).currentExecutingItem = currentItem;
        const result = await autoExecutor.handlePtyCrashRecovery();
        if (i === 0) {
          expect(result).toBe(true);
        } else {
          expect(result).toBe(false);
        }
      }

      expect(mockDisplay.setPaused).toHaveBeenCalledWith(true);
      expect(mockDisplay.showMessage).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('Claude Code crashed 3 times consecutively')
      );
      expect(mockTelegramNotifier.notify).toHaveBeenCalledWith('task_failed', {
        queueLength: 0,
        message: 'PTY crashed 3 times consecutively',
      });
      expect(autoExecutor.isEnabled()).toBe(false);
    });
  });
});
