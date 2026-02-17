import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StateDetector } from '../../src/state-detector.js';
import { EventEmitter } from 'events';

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

// Mock PTY output stream
class MockPty extends EventEmitter {
  simulateOutput(data: string): void {
    this.emit('data', data);
  }
}

describe('StateDetector + PTY Integration', () => {
  let detector: StateDetector;
  let mockPty: MockPty;

  // Match DEFAULT_CONFIG.idleThresholdMs (1000ms) and requiredStableChecks (3)
  const IDLE_THRESHOLD = 1000;
  const TIME_TO_READY = IDLE_THRESHOLD * 3; // 3 stability checks

  beforeEach(() => {
    vi.useFakeTimers();
    detector = new StateDetector();
    mockPty = new MockPty();

    // Connect PTY output to StateDetector
    mockPty.on('data', (data: string) => {
      detector.analyze(data);
    });
  });

  afterEach(() => {
    detector.dispose();
    vi.useRealTimers();
  });

  it('should track state transitions through PTY output stream', async () => {
    // Given
    const stateHistory: string[] = [];
    detector.on('state_change', (state) => {
      stateHistory.push(state.type);
    });

    // When - simulate Claude Code session with output then idle
    mockPty.simulateOutput('Processing your request...\n');
    mockPty.simulateOutput('Done.\n');

    // Advance past 3 stability checks
    await vi.advanceTimersByTimeAsync(TIME_TO_READY);

    // Then
    expect(stateHistory).toContain('READY');
  });

  it('should remain PROCESSING while output continues', async () => {
    // Given
    mockPty.simulateOutput('Processing...');
    await vi.advanceTimersByTimeAsync(1000);

    // When - more output arrives before threshold
    mockPty.simulateOutput('Still processing...');
    await vi.advanceTimersByTimeAsync(1000);

    // Then - still PROCESSING because timer was reset
    expect(detector.getState().type).toBe('PROCESSING');

    // Advance to reach 2 stability checks
    await vi.advanceTimersByTimeAsync(TIME_TO_READY);
    expect(detector.getState().type).toBe('READY');
  });

  it('should transition from READY to PROCESSING on new output', async () => {
    // Given - reach READY state (2 stability checks)
    mockPty.simulateOutput('Output');
    await vi.advanceTimersByTimeAsync(TIME_TO_READY);
    expect(detector.getState().type).toBe('READY');

    // When - new output arrives
    mockPty.simulateOutput('New output');

    // Then
    expect(detector.getState().type).toBe('PROCESSING');
  });

  it('should handle rapid output bursts', async () => {
    // Given
    const stateHistory: string[] = [];
    detector.on('state_change', (state) => {
      stateHistory.push(state.type);
    });

    // When - rapid bursts of output
    for (let i = 0; i < 10; i++) {
      mockPty.simulateOutput(`Burst ${i}\n`);
      await vi.advanceTimersByTimeAsync(100); // Short intervals
    }

    // Then - should still be PROCESSING
    expect(detector.getState().type).toBe('PROCESSING');

    // Advance to idle (2 stability checks)
    await vi.advanceTimersByTimeAsync(TIME_TO_READY);
    expect(detector.getState().type).toBe('READY');
  });

  it('should reset state when reset() is called during PTY session', async () => {
    // Given - reach READY state
    mockPty.simulateOutput('Output');
    await vi.advanceTimersByTimeAsync(TIME_TO_READY);
    expect(detector.getState().type).toBe('READY');

    // When
    detector.reset();

    // Then
    expect(detector.getState().type).toBe('PROCESSING');
    expect(detector.isReadyForQueue()).toBe(false);
  });

  it('should use custom idle threshold from config', async () => {
    // Given - detector with custom threshold and 2 checks
    const customThreshold = 3000;
    const customDetector = new StateDetector({ idleThresholdMs: customThreshold, requiredStableChecks: 2 });
    const customPty = new MockPty();
    customPty.on('data', (data: string) => customDetector.analyze(data));

    // When
    customPty.simulateOutput('Output');
    await vi.advanceTimersByTimeAsync(customThreshold); // 1st check

    // Then - not READY yet (need 2 checks)
    expect(customDetector.getState().type).toBe('PROCESSING');

    // Advance for 2nd check
    await vi.advanceTimersByTimeAsync(customThreshold);
    expect(customDetector.getState().type).toBe('READY');

    customDetector.dispose();
  });
});
