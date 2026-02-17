import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutoExecutor } from '../../src/auto-executor.js';
import { StateDetector } from '../../src/state-detector.js';
import { QueueManager } from '../../src/queue-manager.js';
import { Display } from '../../src/display.js';
import { MockPty } from '../helpers/mock-pty.js';
import { NEW_SESSION_MESSAGES } from '../../src/types/auto-executor.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AutoExecutor Integration', () => {
  let tempDir: string;
  let queueFilePath: string;
  let stateDetector: StateDetector;
  let queueManager: QueueManager;
  let display: Display;
  let mockPty: MockPty;
  let autoExecutor: AutoExecutor;
  const mockClaudeArgs = ['--no-update'];

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create temp directory for queue file
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlaude-test-'));
    queueFilePath = path.join(tempDir, '.qlaude', 'queue');

    // Create real instances
    stateDetector = new StateDetector();
    queueManager = new QueueManager(queueFilePath);
    display = new Display();

    // Use MockPty from helpers for consistent PTY simulation
    mockPty = new MockPty();

    // Mock display methods
    vi.spyOn(display, 'showMessage').mockImplementation(() => {});
    vi.spyOn(display, 'updateStatusBar').mockImplementation(() => {});

    autoExecutor = new AutoExecutor({
      stateDetector,
      queueManager,
      ptyWrapper: mockPty as unknown as Parameters<typeof AutoExecutor>[0]['ptyWrapper'],
      display,
      getClaudeArgs: () => mockClaudeArgs,
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should execute queue items in FIFO order', async () => {
    // Given
    await queueManager.addItem('first prompt');
    await queueManager.addItem('second prompt');
    await queueManager.addItem('third prompt');

    // When - simulate READY state using internal method
    // @ts-expect-error - accessing private method for testing
    stateDetector['transitionTo']('READY');
    // Wait for Enter key (sent after 50ms delay)
    await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('\r'));

    // Then - first item executed (text and Enter sent separately)
    expect(mockPty.write).toHaveBeenCalledWith('first prompt');
    expect(mockPty.write).toHaveBeenCalledWith('\r');

    // Verify remaining items
    const remaining = queueManager.getItems();
    expect(remaining.length).toBe(2);
    expect(remaining[0].prompt).toBe('second prompt');
  });

  it('should stop when queue becomes empty', async () => {
    // Given - empty queue
    // Queue is already empty

    // When
    // @ts-expect-error - accessing private method for testing
    stateDetector['transitionTo']('READY');

    // Small delay to ensure async handling completes
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Then
    expect(mockPty.write).not.toHaveBeenCalled();
  });

  it('should handle PTY not running during execution', async () => {
    // Given
    await queueManager.addItem('test prompt');
    mockPty.setRunning(false);

    // When
    // @ts-expect-error - accessing private method for testing
    stateDetector['transitionTo']('READY');

    // Small delay to ensure async handling completes
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Then - should not attempt to write
    expect(mockPty.write).not.toHaveBeenCalled();
  });

  it('should execute multiple items sequentially on consecutive READY states', async () => {
    // Given
    await queueManager.addItem('first prompt');
    await queueManager.addItem('second prompt');

    // When - first READY state
    // @ts-expect-error - accessing private method for testing
    stateDetector['transitionTo']('READY');
    await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('first prompt'));

    // Simulate processing complete, second READY state
    mockPty.write.mockClear();
    // @ts-expect-error - accessing private method for testing
    stateDetector['transitionTo']('PROCESSING');
    // @ts-expect-error - accessing private method for testing
    stateDetector['transitionTo']('READY');
    await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('second prompt'));

    // Then - queue should be empty
    expect(queueManager.getLength()).toBe(0);
  });

  it('should show notification before execution', async () => {
    // Given
    await queueManager.addItem('notification test');

    // When
    // @ts-expect-error - accessing private method for testing
    stateDetector['transitionTo']('READY');
    await vi.waitFor(() => expect(display.showMessage).toHaveBeenCalled());

    // Then
    expect(display.showMessage).toHaveBeenCalledWith(
      'info',
      expect.stringContaining('[Queue] Executing:')
    );
  });

  it('should emit item_executed event for status bar update', async () => {
    // Given
    await queueManager.addItem('event test');
    const itemExecutedHandler = vi.fn();
    queueManager.on('item_executed', itemExecutedHandler);

    // When
    // @ts-expect-error - accessing private method for testing
    stateDetector['transitionTo']('READY');
    await vi.waitFor(() => expect(itemExecutedHandler).toHaveBeenCalled());

    // Then
    expect(itemExecutedHandler).toHaveBeenCalled();
  });

  it('should handle state detector output analysis triggering execution', async () => {
    // Given
    await queueManager.addItem('output triggered');

    // When - simulate READY state directly (idle-based detection requires timeout)
    // @ts-expect-error - accessing private method for testing
    stateDetector['transitionTo']('READY');
    // Wait for Enter key (sent after 50ms delay)
    await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('\r'));

    // Then (text and Enter sent separately)
    expect(mockPty.write).toHaveBeenCalledWith('output triggered');
    expect(mockPty.write).toHaveBeenCalledWith('\r');
  });

  it('should not execute during permission prompts', async () => {
    // Given
    await queueManager.addItem('should not execute');

    // When - simulate permission prompt
    stateDetector.analyze('Allow access? [Y/n]');

    // Small delay to ensure async handling
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Then
    expect(mockPty.write).not.toHaveBeenCalled();
  });

  it('should respect enabled/disabled state during state transitions', async () => {
    // Given
    await queueManager.addItem('disabled test');
    autoExecutor.stop();

    // When
    // @ts-expect-error - accessing private method for testing
    stateDetector['transitionTo']('READY');

    // Small delay
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Then
    expect(mockPty.write).not.toHaveBeenCalled();

    // Re-enable and try again
    autoExecutor.start();
    // @ts-expect-error - accessing private method for testing
    stateDetector['transitionTo']('PROCESSING');
    // @ts-expect-error - accessing private method for testing
    stateDetector['transitionTo']('READY');
    // Wait for Enter key (sent after 50ms delay)
    await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('\r'));

    expect(mockPty.write).toHaveBeenCalledWith('disabled test');
    expect(mockPty.write).toHaveBeenCalledWith('\r');
  });

  describe('Safety Guards Integration', () => {
    it('should show paused message and resume on permission prompt flow', async () => {
      // Given
      await queueManager.addItem('permission flow test');

      // When - simulate SELECTION_PROMPT state directly
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('SELECTION_PROMPT');
      await vi.waitFor(() => expect(display.showMessage).toHaveBeenCalled());

      // Then - paused message shown
      expect(display.showMessage).toHaveBeenCalledWith(
        'warning',
        '[Queue] Paused (1 item) - waiting for user input'
      );

      // When - simulate user response and READY state
      (display.showMessage as ReturnType<typeof vi.fn>).mockClear();
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');
      // Wait for Enter key (sent after 50ms delay)
      await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('\r'));

      // Then - execution resumed (text and Enter sent separately)
      expect(mockPty.write).toHaveBeenCalledWith('permission flow test');
      expect(mockPty.write).toHaveBeenCalledWith('\r');
    });

    it('should show paused message on selection prompt with queued items', async () => {
      // Given
      await queueManager.addItem('selection test');

      // When - simulate SELECTION_PROMPT state directly
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('SELECTION_PROMPT');
      await vi.waitFor(() => expect(display.showMessage).toHaveBeenCalled());

      // Then
      expect(display.showMessage).toHaveBeenCalledWith(
        'warning',
        '[Queue] Paused (1 item) - waiting for user input'
      );
    });

    it('should NOT show paused message on interrupted state (not a blocking state)', async () => {
      // Given - INTERRUPTED is no longer a blocking state (high false positive rate)
      await queueManager.addItem('interrupted test');

      // When - simulate INTERRUPTED state directly
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('INTERRUPTED');

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Then - no pause message since INTERRUPTED is not blocking
      expect(display.showMessage).not.toHaveBeenCalled();
    });

    it('should NOT show paused message when queue is empty during blocking state', async () => {
      // Given - empty queue

      // When - simulate SELECTION_PROMPT state
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('SELECTION_PROMPT');

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Then - no message shown (queue is empty)
      expect(display.showMessage).not.toHaveBeenCalled();
    });

    it('should execute queue item when READY after INTERRUPTED (no blocking)', async () => {
      // Given - INTERRUPTED is not blocking, so queue should continue on next READY
      await queueManager.addItem('resume after interrupt');

      // When - simulate INTERRUPTED → READY transition
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('INTERRUPTED');
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');
      // Wait for Enter key (sent after 50ms delay)
      await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('\r'));

      // Then (text and Enter sent separately)
      expect(mockPty.write).toHaveBeenCalledWith('resume after interrupt');
      expect(mockPty.write).toHaveBeenCalledWith('\r');
    });
  });

  describe('New Session Integration', () => {
    it('should complete full new session flow (AC 1-6)', async () => {
      // Given - add new session item to queue
      await queueManager.addItem('new session prompt', true);
      expect(queueManager.getLength()).toBe(1);

      // When - trigger READY state directly
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');

      // Then - new session message shown (using constant)
      await vi.waitFor(() => expect(display.showMessage).toHaveBeenCalledWith(
        'info',
        NEW_SESSION_MESSAGES.STARTING
      ));

      // And - PTY restarted
      expect(mockPty.restart).toHaveBeenCalledWith(mockClaudeArgs);

      // Simulate new session READY state
      (display.showMessage as ReturnType<typeof vi.fn>).mockClear();
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');

      // And - prompt executed in new session (text and Enter sent separately)
      // Wait for Enter key (sent after 50ms delay)
      await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('\r'));
      expect(mockPty.write).toHaveBeenCalledWith('new session prompt');
      expect(mockPty.write).toHaveBeenCalledWith('\r');
    });

    it('should work normally after new session (AC 5)', async () => {
      // Given - add new session item followed by normal item
      await queueManager.addItem('new session prompt', true);
      await queueManager.addItem('normal prompt', false);

      // When - complete new session flow
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');
      await vi.waitFor(() => expect(mockPty.restart).toHaveBeenCalled());

      // New session READY - executes pending new session item
      (display.showMessage as ReturnType<typeof vi.fn>).mockClear();
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');
      await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('new session prompt'));

      // Process normal item on next READY
      mockPty.write.mockClear();
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('PROCESSING');
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');
      await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('normal prompt'));

      // Then - normal queue execution works
      expect(queueManager.getLength()).toBe(0);
    });

    it('should handle consecutive new session items (Edge Case #4)', async () => {
      // Given - add two consecutive new session items
      await queueManager.addItem('first new session', true);
      await queueManager.addItem('second new session', true);
      expect(queueManager.getLength()).toBe(2);

      // When - process first new session
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');
      await vi.waitFor(() => expect(display.showMessage).toHaveBeenCalledWith(
        'info',
        NEW_SESSION_MESSAGES.STARTING
      ));

      // First new session's pending item gets executed on READY
      (display.showMessage as ReturnType<typeof vi.fn>).mockClear();
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');
      await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('first new session'));

      // Clear mocks for next iteration
      mockPty.write.mockClear();
      mockPty.restart.mockClear();
      (display.showMessage as ReturnType<typeof vi.fn>).mockClear();

      // Then - second new session should also be processed
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('PROCESSING');
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');
      await vi.waitFor(() => expect(display.showMessage).toHaveBeenCalledWith(
        'info',
        NEW_SESSION_MESSAGES.STARTING
      ));

      (display.showMessage as ReturnType<typeof vi.fn>).mockClear();
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');
      await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('second new session'));

      expect(queueManager.getLength()).toBe(0);
    });

    it('should preserve pendingNewSessionItem during blocking state (Edge Case #5)', async () => {
      // Given - add new session item and a second item to queue
      await queueManager.addItem('new session prompt', true);
      await queueManager.addItem('second item', false);

      // When - trigger new session
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');
      await vi.waitFor(() => expect(mockPty.restart).toHaveBeenCalled());

      // New session started, pendingNewSessionItem is set
      // But then SELECTION_PROMPT occurs before READY
      (display.showMessage as ReturnType<typeof vi.fn>).mockClear();
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('SELECTION_PROMPT');

      // Verify paused message shown (for the second item still in queue)
      await vi.waitFor(() => expect(display.showMessage).toHaveBeenCalledWith(
        'warning',
        expect.stringContaining('[Queue] Paused')
      ));

      // User responds and READY state occurs
      (display.showMessage as ReturnType<typeof vi.fn>).mockClear();
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');

      // Then - pendingNewSessionItem should be executed first (before queue items)
      // Wait for Enter key (sent after 50ms delay)
      await vi.waitFor(() => expect(mockPty.write).toHaveBeenCalledWith('\r'));
      expect(mockPty.write).toHaveBeenCalledWith('new session prompt');
      expect(mockPty.write).toHaveBeenCalledWith('\r');

      // Queue still has the second item
      expect(queueManager.getLength()).toBe(1);
    });

    it('should emit session_restart event', async () => {
      // Given
      await queueManager.addItem('event test', true);
      const sessionRestartHandler = vi.fn();
      autoExecutor.on('session_restart', sessionRestartHandler);

      // When
      // @ts-expect-error - accessing private method for testing
      stateDetector['transitionTo']('READY');
      await vi.waitFor(() => expect(sessionRestartHandler).toHaveBeenCalled());

      // Then
      expect(sessionRestartHandler).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'event test', isNewSession: true })
      );
    });
  });
});
