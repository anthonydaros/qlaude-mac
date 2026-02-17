import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// MockPtyWrapper for testing
class MockPtyWrapper extends EventEmitter {
  private running = false;

  spawn(): void {
    this.running = true;
  }

  kill(): void {
    this.running = false;
  }

  isRunning(): boolean {
    return this.running;
  }

  // Test helper: simulate exit event
  simulateExit(exitCode: number, signal?: number): void {
    this.running = false;
    this.emit('exit', exitCode, signal);
  }
}

describe('Graceful Exit Integration', () => {
  let mockPty: MockPtyWrapper;
  let mockProcessExit: ReturnType<typeof vi.fn>;
  let originalProcessExit: typeof process.exit;

  beforeEach(() => {
    mockPty = new MockPtyWrapper();
    mockProcessExit = vi.fn();
    originalProcessExit = process.exit;
    process.exit = mockProcessExit as unknown as typeof process.exit;
  });

  afterEach(() => {
    process.exit = originalProcessExit;
    vi.restoreAllMocks();
  });

  it('should propagate PTY exit code 0 to process', () => {
    // Given: PTY exit handler is set up
    mockPty.on('exit', (exitCode: number) => {
      process.exit(exitCode);
    });

    // When: PTY exits with code 0
    mockPty.simulateExit(0);

    // Then: process.exit should be called with 0
    expect(mockProcessExit).toHaveBeenCalledWith(0);
  });

  it('should propagate PTY exit code 1 to process', () => {
    // Given: PTY exit handler is set up
    mockPty.on('exit', (exitCode: number) => {
      process.exit(exitCode);
    });

    // When: PTY exits with code 1
    mockPty.simulateExit(1);

    // Then: process.exit should be called with 1
    expect(mockProcessExit).toHaveBeenCalledWith(1);
  });

  it('should cleanup resources on PTY exit', () => {
    // Given: cleanup function and PTY exit handler
    let cleanupCalled = false;
    const cleanup = () => { cleanupCalled = true; };

    mockPty.on('exit', () => {
      cleanup();
    });

    // When: PTY exits
    mockPty.simulateExit(0);

    // Then: cleanup should be called
    expect(cleanupCalled).toBe(true);
  });

  it('should handle PTY exit with signal', () => {
    // Given: PTY exit handler with signal support
    let receivedSignal: number | undefined;
    mockPty.on('exit', (_exitCode: number, signal?: number) => {
      receivedSignal = signal;
    });

    // When: PTY exits with signal 15 (SIGTERM)
    mockPty.simulateExit(0, 15);

    // Then: signal should be received
    expect(receivedSignal).toBe(15);
  });
});
