import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Display } from '../../src/display.js';
import type { QueueItem } from '../../src/types/queue.js';

describe('Display', () => {
  let display: Display;
  let mockWrite: ReturnType<typeof vi.spyOn>;
  const originalColumns = process.stdout.columns;
  const originalRows = process.stdout.rows;

  beforeEach(() => {
    vi.resetAllMocks();
    display = new Display();
    mockWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    // Set default terminal size
    Object.defineProperty(process.stdout, 'columns', { value: 80, writable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 30, writable: true });
  });

  afterEach(() => {
    mockWrite.mockRestore();
    Object.defineProperty(process.stdout, 'columns', { value: originalColumns, writable: true });
    Object.defineProperty(process.stdout, 'rows', { value: originalRows, writable: true });
  });

  describe('updateStatusBar()', () => {
    it('should show "[empty]" when queue is empty', () => {
      // Given
      const items: QueueItem[] = [];

      // When
      display.updateStatusBar(items);

      // Then
      expect(mockWrite).toHaveBeenCalled();
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('[empty]');
    });

    it('should display 1 item correctly', () => {
      // Given
      const items: QueueItem[] = [{ prompt: 'Task 1', isNewSession: false }];

      // When
      display.updateStatusBar(items);

      // Then
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('[1 item]');
      expect(output).toContain('Task 1');
    });

    it('should display multiple items with correct count', () => {
      // Given
      const items: QueueItem[] = [
        { prompt: 'Task 1', isNewSession: false },
        { prompt: 'Task 2', isNewSession: false },
        { prompt: 'Task 3', isNewSession: false },
      ];

      // When
      display.updateStatusBar(items);

      // Then
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('[3 items]');
      expect(output).toContain('Task 1');
      expect(output).toContain('Task 2');
      expect(output).toContain('Task 3');
    });

    it('should show "..and N more" when more than 3 items (MAX_DISPLAY_ITEMS)', () => {
      // Given - MAX_DISPLAY_ITEMS is 3
      const items: QueueItem[] = Array.from({ length: 6 }, (_, i) => ({
        prompt: `Task ${i + 1}`,
        isNewSession: false,
      }));

      // When
      display.updateStatusBar(items);

      // Then
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('[6 items]');
      expect(output).toContain('..and 3 more');
      // Should only show first 3 tasks
      expect(output).toContain('Task 1');
      expect(output).toContain('Task 3');
      expect(output).not.toContain('Task 4');
    });

    it('should mark new session items with [NEW]', () => {
      // Given
      const items: QueueItem[] = [
        { prompt: 'Normal task', isNewSession: false },
        { prompt: 'New session task', isNewSession: true },
      ];

      // When
      display.updateStatusBar(items);

      // Then
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('[NEW]');
    });

    it('should not render when disabled', () => {
      // Given
      const items: QueueItem[] = [{ prompt: 'Task 1', isNewSession: false }];
      display.toggle(); // Disable

      // When
      display.updateStatusBar(items);

      // Then
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should truncate long prompts to fit terminal width', () => {
      // Given
      Object.defineProperty(process.stdout, 'columns', { value: 40, writable: true });
      const longPrompt = 'A'.repeat(100);
      const items: QueueItem[] = [{ prompt: longPrompt, isNewSession: false }];

      // When
      display.updateStatusBar(items);

      // Then
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('...');
      expect(output).not.toContain('A'.repeat(100));
    });
  });

  describe('toggle()', () => {
    it('should return false after first toggle (now disabled)', () => {
      // Given - initially enabled

      // When
      const result = display.toggle();

      // Then
      expect(result).toBe(false);
    });

    it('should return true after second toggle (now enabled)', () => {
      // Given
      display.toggle(); // disable

      // When
      const result = display.toggle();

      // Then
      expect(result).toBe(true);
    });

    it('should call clear when toggled off', () => {
      // Given - first render some content to set lastHeight
      const items: QueueItem[] = [{ prompt: 'Task 1', isNewSession: false }];
      display.updateStatusBar(items);
      mockWrite.mockClear();

      // When
      display.toggle(); // off

      // Then - clear() should have been called (writes to stdout)
      expect(mockWrite).toHaveBeenCalled();
    });

    it('should not render when disabled', () => {
      // Given
      display.toggle(); // disable
      mockWrite.mockClear(); // clear any calls from toggle
      const items: QueueItem[] = [{ prompt: 'Task 1', isNewSession: false }];

      // When
      display.updateStatusBar(items);

      // Then
      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  describe('clear()', () => {
    it('should clear status bar area', () => {
      // Given - first render some content
      const items: QueueItem[] = [{ prompt: 'Task 1', isNewSession: false }];
      display.updateStatusBar(items);
      mockWrite.mockClear();

      // When
      display.clear();

      // Then
      expect(mockWrite).toHaveBeenCalled();
    });

    it('should not write when lastHeight is 0', () => {
      // Given - new display with no previous render

      // When
      display.clear();

      // Then
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should clear lines in status bar area', () => {
      // Given
      const items: QueueItem[] = [{ prompt: 'Task 1', isNewSession: false }];
      display.updateStatusBar(items);
      mockWrite.mockClear();

      // When
      display.clear();

      // Then
      expect(mockWrite).toHaveBeenCalled();
      // Should contain cursor movement sequences for clearing lines
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('\x1b['); // Contains ANSI escape sequences
    });
  });

  describe('getStatusBarHeight (via updateStatusBar behavior)', () => {
    it('should have height of 5 (fixed STATUS_BAR_HEIGHT)', () => {
      // Given
      const items: QueueItem[] = [];

      // When
      display.updateStatusBar(items);

      // Then
      expect(display.getHeight()).toBe(5); // Fixed height for logo
    });

    it('should calculate correct "..and N more" for items exceeding MAX_DISPLAY_ITEMS', () => {
      // Given - 5 items, MAX_DISPLAY_ITEMS is 3, so should show "..and 2 more"
      const items: QueueItem[] = Array.from({ length: 5 }, (_, i) => ({
        prompt: `Task ${i + 1}`,
        isNewSession: false,
      }));

      // When
      display.updateStatusBar(items);

      // Then
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('..and 2 more');
    });
  });

  describe('showMessage()', () => {
    it('should show info message', () => {
      // Given
      const items: QueueItem[] = [{ prompt: 'Task 1', isNewSession: false }];
      display.updateStatusBar(items);
      mockWrite.mockClear();

      // When
      display.showMessage('info', 'Test info message');

      // Then
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('Test info message');
    });

    it('should show error message', () => {
      // Given
      const items: QueueItem[] = [{ prompt: 'Task 1', isNewSession: false }];
      display.updateStatusBar(items);
      mockWrite.mockClear();

      // When
      display.showMessage('error', 'Test error');

      // Then
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('Test error');
    });
  });

  describe('setPaused()', () => {
    it('should show [paused] when paused', () => {
      // Given
      const items: QueueItem[] = [{ prompt: 'Task 1', isNewSession: false }];
      display.setPaused(true);

      // When
      display.updateStatusBar(items);

      // Then
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('[paused]');
    });

    it('should show [running] when not paused', () => {
      // Given
      const items: QueueItem[] = [{ prompt: 'Task 1', isNewSession: false }];
      display.setPaused(false);

      // When
      display.updateStatusBar(items);

      // Then
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('[running]');
    });
  });
});
