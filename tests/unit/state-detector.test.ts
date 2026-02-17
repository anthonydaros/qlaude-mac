import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateDetector } from '../../src/state-detector.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
  },
}));

describe('StateDetector', () => {
  let detector: StateDetector;
  // Match DEFAULT_CONFIG.idleThresholdMs (1000ms) and requiredStableChecks (3)
  // Total time to READY = idleThreshold * requiredStableChecks = 3000ms
  const IDLE_THRESHOLD = 1000;
  const REQUIRED_STABLE_CHECKS = 3;
  const TIME_TO_READY = IDLE_THRESHOLD * REQUIRED_STABLE_CHECKS;

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new StateDetector();
  });

  afterEach(() => {
    detector.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('initial state', () => {
    it('should start with PROCESSING state', () => {
      const state = detector.getState();
      expect(state.type).toBe('PROCESSING');
    });
  });

  describe('idle-based detection with screen stability', () => {
    it('should transition to READY after 3 consecutive stable screen checks', async () => {
      // Given - analyze some output
      detector.analyze('some output');
      expect(detector.getState().type).toBe('PROCESSING');

      // When - advance past first idle threshold (1st stability check)
      await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD);
      expect(detector.getState().type).toBe('PROCESSING'); // Not READY yet

      // When - advance past second idle threshold (2nd stability check)
      await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD);
      expect(detector.getState().type).toBe('PROCESSING'); // Still not READY

      // When - advance past third idle threshold (3rd stability check)
      await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD);

      // Then - now READY after 3 consecutive stable checks
      expect(detector.getState().type).toBe('READY');
    });

    it('should remain PROCESSING if output continues before threshold', async () => {
      // Given - analyze some output
      detector.analyze('output 1');
      await vi.advanceTimersByTimeAsync(1000); // Wait 1 second (before threshold)
      expect(detector.getState().type).toBe('PROCESSING');

      // When - more output arrives (resets timer)
      detector.analyze('output 2');
      await vi.advanceTimersByTimeAsync(1000); // Another second (before threshold)
      expect(detector.getState().type).toBe('PROCESSING');

      // Wait for full time to READY (2 stability checks)
      await vi.advanceTimersByTimeAsync(TIME_TO_READY);

      // Then - now READY
      expect(detector.getState().type).toBe('READY');
    });

    it('should transition from READY to PROCESSING on new output', async () => {
      // Given - in READY state
      detector.analyze('initial output');
      await vi.advanceTimersByTimeAsync(TIME_TO_READY);
      expect(detector.getState().type).toBe('READY');

      // When - new output arrives
      detector.analyze('new output');

      // Then
      expect(detector.getState().type).toBe('PROCESSING');
    });

    it('should use custom idle threshold from config', async () => {
      // Given - detector with custom threshold and 2 checks
      const customThreshold = 3000;
      const customDetector = new StateDetector({ idleThresholdMs: customThreshold, requiredStableChecks: 2 });
      customDetector.analyze('output');

      // When - wait for first check
      await vi.advanceTimersByTimeAsync(customThreshold);
      expect(customDetector.getState().type).toBe('PROCESSING');

      // When - wait for second check
      await vi.advanceTimersByTimeAsync(customThreshold);

      // Then - now READY after 2 stable checks
      expect(customDetector.getState().type).toBe('READY');

      customDetector.dispose();
    });
  });

  describe('events', () => {
    it('should emit state_change event when transitioning to READY', async () => {
      // Given
      const listener = vi.fn();
      detector.on('state_change', listener);

      // When
      detector.analyze('output');
      await vi.advanceTimersByTimeAsync(TIME_TO_READY);

      // Then
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'READY' }));
    });

    it('should emit state_change event when transitioning from READY to PROCESSING', async () => {
      // Given - in READY state
      detector.analyze('initial');
      await vi.advanceTimersByTimeAsync(TIME_TO_READY);

      const listener = vi.fn();
      detector.on('state_change', listener);

      // When - new output arrives
      detector.analyze('new output');

      // Then
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'PROCESSING' }));
    });

    it('should emit event with timestamp', async () => {
      // Given
      const listener = vi.fn();
      detector.on('state_change', listener);
      const before = Date.now();

      // When
      detector.analyze('output');
      await vi.advanceTimersByTimeAsync(TIME_TO_READY);

      // Then
      expect(listener).toHaveBeenCalled();
      const state = listener.mock.calls[0][0];
      expect(state.timestamp).toBeGreaterThanOrEqual(before);
    });
  });

  describe('reset()', () => {
    it('should reset to PROCESSING state', async () => {
      // Given - in READY state
      detector.analyze('output');
      await vi.advanceTimersByTimeAsync(TIME_TO_READY);
      expect(detector.getState().type).toBe('READY');

      // When
      detector.reset();

      // Then
      expect(detector.getState().type).toBe('PROCESSING');
    });

    it('should restart idle timer after reset and transition to READY', async () => {
      // Given - analyze some output
      detector.analyze('output');

      // When - reset before threshold
      detector.reset();

      // Then - should be PROCESSING immediately after reset
      expect(detector.getState().type).toBe('PROCESSING');

      // Wait for stability checks after reset
      await vi.advanceTimersByTimeAsync(TIME_TO_READY);

      // Then - should transition to READY (reset starts fresh idle timer)
      expect(detector.getState().type).toBe('READY');
    });

    it('should emit state_change event on reset', async () => {
      // Given - in READY state
      detector.analyze('output');
      await vi.advanceTimersByTimeAsync(TIME_TO_READY);

      const listener = vi.fn();
      detector.on('state_change', listener);

      // When
      detector.reset();

      // Then
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: 'PROCESSING' }));
    });
  });

  describe('isReadyForQueue()', () => {
    it('should return true when state is READY', async () => {
      // Given
      detector.analyze('output');
      await vi.advanceTimersByTimeAsync(TIME_TO_READY);

      // Then
      expect(detector.isReadyForQueue()).toBe(true);
    });

    it('should return false when state is PROCESSING', () => {
      // Given - initial state is PROCESSING

      // Then
      expect(detector.isReadyForQueue()).toBe(false);
    });
  });

  describe('dispose()', () => {
    it('should clear idle timer on dispose', async () => {
      // Given - analyze some output
      detector.analyze('output');

      // When - dispose before threshold
      detector.dispose();
      await vi.advanceTimersByTimeAsync(TIME_TO_READY);

      // Then - should stay PROCESSING (timer was cleared)
      expect(detector.getState().type).toBe('PROCESSING');
    });
  });

  describe('forceReady()', () => {
    it('should immediately transition to READY without waiting', () => {
      // Given - PROCESSING state
      detector.analyze('output');
      expect(detector.getState().type).toBe('PROCESSING');

      // When
      detector.forceReady();

      // Then - immediately READY
      expect(detector.getState().type).toBe('READY');
    });

    it('should reset stability tracking', async () => {
      // Given - force READY
      detector.forceReady();
      expect(detector.getState().type).toBe('READY');

      // When - new output arrives
      detector.analyze('new output');
      expect(detector.getState().type).toBe('PROCESSING');

      // Then - normal stability checks apply (need REQUIRED_STABLE_CHECKS checks)
      await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD);
      expect(detector.getState().type).toBe('PROCESSING'); // Still need more checks

      await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD);
      expect(detector.getState().type).toBe('PROCESSING'); // Still need one more

      await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD);
      expect(detector.getState().type).toBe('READY');
    });
  });

  describe('transitionTo() (private method for testing)', () => {
    it('should allow direct state transitions for testing', () => {
      // When
      // @ts-expect-error - accessing private method for testing
      detector['transitionTo']('READY');

      // Then
      expect(detector.getState().type).toBe('READY');
    });

    it('should support blocking states for auto-executor integration', () => {
      // When
      // @ts-expect-error - accessing private method for testing
      detector['transitionTo']('SELECTION_PROMPT');

      // Then
      expect(detector.getState().type).toBe('SELECTION_PROMPT');
    });

    it('should support TASK_FAILED state', () => {
      // When
      // @ts-expect-error - accessing private method for testing
      detector['transitionTo']('TASK_FAILED');

      // Then
      expect(detector.getState().type).toBe('TASK_FAILED');
    });
  });

  describe('prompt input line filtering', () => {
    const FAST_IDLE = 100;

    it('should filter out prompt input line between ──── separators', async () => {
      // User typed "[Y/n]" in prompt — should not trigger SELECTION_PROMPT
      const screenLines = [
        '  Some Claude output here.',
        '',
        '──────────────────────────────────────────────────────────────────────────────────────────────────',
        '❯ test [Y/n] something',
        '──────────────────────────────────────────────────────────────────────────────────────────────────',
        '   🤖 Opus 4.6  📁 project',
        '',
      ];
      const d = new StateDetector({
        idleThresholdMs: FAST_IDLE,
        requiredStableChecks: 2,
        screenContentProvider: () => screenLines,
      });
      d.analyze('output');

      await vi.advanceTimersByTimeAsync(FAST_IDLE * 3);

      expect(d.getState().type).toBe('READY');
      d.dispose();
    });

    it('should detect SELECTION_PROMPT from [Y/n] in Claude output', async () => {
      const screenLines = [
        '  Allow Bash: npm install? [Y/n]',
        '',
        '──────────────────────────────────────────────────────────────────────────────────────────────────',
        '❯  ',
        '──────────────────────────────────────────────────────────────────────────────────────────────────',
        '   🤖 Opus 4.6  📁 project',
        '',
      ];
      const d = new StateDetector({
        idleThresholdMs: FAST_IDLE,
        requiredStableChecks: 2,
        screenContentProvider: () => screenLines,
      });
      d.analyze('output');

      await vi.advanceTimersByTimeAsync(FAST_IDLE);

      expect(d.getState().type).toBe('SELECTION_PROMPT');
      d.dispose();
    });

    it('should NOT false-detect from permission keywords in code output', async () => {
      // "approve", "deny", "Allow" in code diff should NOT trigger SELECTION_PROMPT
      const screenLines = [
        '      25 +    const handleApprove = () => {',
        '      26 +      Allow(item.id);',
        '      27 +      deny(other.id);',
        '',
        '✻ Baked for 30s',
        '',
        '──────────────────────────────────────────────────────────────────────────────────────────────────',
        '❯  ',
        '──────────────────────────────────────────────────────────────────────────────────────────────────',
        '   🤖 Opus 4.6  📁 project',
        '',
      ];
      const d = new StateDetector({
        idleThresholdMs: FAST_IDLE,
        requiredStableChecks: 2,
        screenContentProvider: () => screenLines,
      });
      d.analyze('output');

      await vi.advanceTimersByTimeAsync(FAST_IDLE * 3);

      // No structural UI patterns → READY, not SELECTION_PROMPT
      expect(d.getState().type).toBe('READY');
      d.dispose();
    });
  });

  describe('screen stability check', () => {
    it('should reset stability counter when screen content changes', async () => {
      // Given - detector with screen content provider that changes
      let screenContent = ['line 1'];
      const detectorWithProvider = new StateDetector({
        screenContentProvider: () => screenContent,
      });
      detectorWithProvider.analyze('output');

      // First check - screen set
      await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD);
      expect(detectorWithProvider.getState().type).toBe('PROCESSING');

      // Change screen content before second check
      screenContent = ['line 2'];
      await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD);
      expect(detectorWithProvider.getState().type).toBe('PROCESSING'); // Reset due to change

      // Now stable - wait for REQUIRED_STABLE_CHECKS checks
      await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD);
      expect(detectorWithProvider.getState().type).toBe('PROCESSING'); // 1st stable
      await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD);
      expect(detectorWithProvider.getState().type).toBe('PROCESSING'); // 2nd stable
      await vi.advanceTimersByTimeAsync(IDLE_THRESHOLD);
      expect(detectorWithProvider.getState().type).toBe('READY'); // 3rd stable → READY

      detectorWithProvider.dispose();
    });
  });

  describe('TASK_FAILED detection', () => {
    const FAST_IDLE = 100;

    it('should detect rate limit message on ⎿ lines (not filtered out)', async () => {
      // Rate limit messages appear on ⎿ lines which were previously filtered
      const screenLines = [
        '❯ /BMad:agents:qa ',
        '',
        '● Read 1 file (ctrl+o to expand)',
        '  ⎿  You\'ve hit your limit · resets Feb 12, 2am (Asia/Seoul)',
        '     /upgrade or /extra-usage to finish what you\'re working on.',
        '',
        '─────────────────────────────────────────────────────────────',
        '❯  ',
        '─────────────────────────────────────────────────────────────',
      ];
      const d = new StateDetector({
        idleThresholdMs: FAST_IDLE,
        requiredStableChecks: 2,
        screenContentProvider: () => screenLines,
      });
      d.analyze('output');

      await vi.advanceTimersByTimeAsync(FAST_IDLE);

      expect(d.getState().type).toBe('TASK_FAILED');
      d.dispose();
    });

    it('should detect rate limit even when spinner is active', async () => {
      // Rate limit with an active spinner should still be detected
      const screenLines = [
        '  ⎿  You\'ve hit your limit · resets Feb 12, 2am (Asia/Seoul)',
        '',
        '✢ Orbiting… (1m 4s · ↓ 1.7k tokens · thought for 1s)',
        '',
        '─────────────────────────────────────────────────────────────',
        '❯  ',
        '─────────────────────────────────────────────────────────────',
      ];
      const d = new StateDetector({
        idleThresholdMs: FAST_IDLE,
        requiredStableChecks: 2,
        screenContentProvider: () => screenLines,
      });
      d.analyze('output');

      await vi.advanceTimersByTimeAsync(FAST_IDLE);

      // TASK_FAILED should bypass stability gate and spinner check
      expect(d.getState().type).toBe('TASK_FAILED');
      d.dispose();
    });

    it('should NOT false-detect "rate limit" in code output', async () => {
      // Code content mentioning "rate limit" should not trigger TASK_FAILED
      const screenLines = [
        '  - rate limiter 테스트 간섭 해결 (Date.now spy)',
        '  - Rate limit 초과 (1분에 10회 제한)',
        '',
        '✻ Baked for 30s',
        '',
        '─────────────────────────────────────────────────────────────',
        '❯  ',
        '─────────────────────────────────────────────────────────────',
      ];
      const d = new StateDetector({
        idleThresholdMs: FAST_IDLE,
        requiredStableChecks: 2,
        screenContentProvider: () => screenLines,
      });
      d.analyze('output');

      await vi.advanceTimersByTimeAsync(FAST_IDLE * 3);

      expect(d.getState().type).toBe('READY');
      d.dispose();
    });

    it('should NOT false-detect "weekly limit" usage info', async () => {
      // Weekly usage info should not trigger TASK_FAILED
      const screenLines = [
        '✻ Baked for 30s',
        '',
        '─────────────────────────────────────────────────────────────',
        '❯ Try "how do I log an error?"',
        '─────────────────────────────────────────────────────────────',
        '  You\'ve used 93% of your weekly limit · resets Feb 12, 2am (Asia/Seoul)',
      ];
      const d = new StateDetector({
        idleThresholdMs: FAST_IDLE,
        requiredStableChecks: 2,
        screenContentProvider: () => screenLines,
      });
      d.analyze('output');

      await vi.advanceTimersByTimeAsync(FAST_IDLE * 3);

      expect(d.getState().type).toBe('READY');
      d.dispose();
    });

    it('should detect QUEUE_STOP marker', async () => {
      const screenLines = [
        '● QUEUE_STOP: task requires manual intervention',
        '',
        '─────────────────────────────────────────────────────────────',
        '❯  ',
        '─────────────────────────────────────────────────────────────',
      ];
      const d = new StateDetector({
        idleThresholdMs: FAST_IDLE,
        requiredStableChecks: 2,
        screenContentProvider: () => screenLines,
      });
      d.analyze('output');

      await vi.advanceTimersByTimeAsync(FAST_IDLE);

      expect(d.getState().type).toBe('TASK_FAILED');
      d.dispose();
    });

    it('should not re-trigger on same markers without reset', async () => {
      // When markers persist on screen without reset, count doesn't increase
      // so TASK_FAILED should not re-trigger on the same markers
      let screenLines: string[] = [
        '  ⎿  You\'ve hit your limit · resets Feb 12, 2am (Asia/Seoul)',
        '',
        '─────────────────────────────────────────────────────────────',
        '❯  ',
        '─────────────────────────────────────────────────────────────',
      ];
      const d = new StateDetector({
        idleThresholdMs: FAST_IDLE,
        requiredStableChecks: 2,
        screenContentProvider: () => screenLines,
      });
      d.analyze('output');

      // First detection
      await vi.advanceTimersByTimeAsync(FAST_IDLE);
      expect(d.getState().type).toBe('TASK_FAILED');

      // Simulate new output (transitions back to PROCESSING)
      d.analyze('new output');
      expect(d.getState().type).toBe('PROCESSING');

      // Same markers still on screen — count unchanged, should NOT re-trigger
      // Instead should stabilize to READY (markers are same count, not increasing)
      await vi.advanceTimersByTimeAsync(FAST_IDLE * 3);
      expect(d.getState().type).not.toBe('TASK_FAILED');

      d.dispose();
    });

    it('should re-trigger after reset if markers still on screen', async () => {
      // After reset(), lastFailureMarkerCount is cleared to 0,
      // so same markers should be detected as new
      const screenLines = [
        '  ⎿  You\'ve hit your limit · resets Feb 12, 2am (Asia/Seoul)',
        '',
        '─────────────────────────────────────────────────────────────',
        '❯  ',
        '─────────────────────────────────────────────────────────────',
      ];
      const d = new StateDetector({
        idleThresholdMs: FAST_IDLE,
        requiredStableChecks: 2,
        screenContentProvider: () => screenLines,
      });
      d.analyze('output');

      // First detection
      await vi.advanceTimersByTimeAsync(FAST_IDLE);
      expect(d.getState().type).toBe('TASK_FAILED');

      // Reset clears marker count — same markers become "new" again
      d.reset();
      expect(d.getState().type).toBe('PROCESSING');

      await vi.advanceTimersByTimeAsync(FAST_IDLE);
      expect(d.getState().type).toBe('TASK_FAILED');

      d.dispose();
    });
  });
});
