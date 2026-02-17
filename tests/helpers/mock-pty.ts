import { vi } from 'vitest';
import { EventEmitter } from 'events';

/**
 * Mock PTY for testing
 * Simulates PtyWrapper behavior without actual terminal
 */
export class MockPty extends EventEmitter {
  private running: boolean = true;

  write = vi.fn();
  resize = vi.fn();
  kill = vi.fn();
  spawn = vi.fn();
  restart = vi.fn().mockResolvedValue(undefined);

  isRunning(): boolean {
    return this.running;
  }

  setRunning(running: boolean): void {
    this.running = running;
  }

  /**
   * Simulate PTY output
   */
  simulateOutput(data: string): void {
    this.emit('data', data);
  }

  /**
   * Simulate PTY exit
   */
  simulateExit(exitCode: number, signal?: number): void {
    this.running = false;
    this.emit('exit', exitCode, signal);
  }

  /**
   * Reset mock state
   */
  reset(): void {
    this.running = true;
    this.write.mockClear();
    this.resize.mockClear();
    this.kill.mockClear();
    this.spawn.mockClear();
    this.restart.mockClear();
    this.removeAllListeners();
  }
}
