import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTerminalSize, reserveBottomLines, resetTerminalScrollRegion } from '../../src/utils/terminal.js';

describe('Terminal utilities', () => {
  const originalColumns = process.stdout.columns;
  const originalRows = process.stdout.rows;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    // Restore original values
    Object.defineProperty(process.stdout, 'columns', {
      value: originalColumns,
      writable: true,
    });
    Object.defineProperty(process.stdout, 'rows', {
      value: originalRows,
      writable: true,
    });
  });

  describe('getTerminalSize()', () => {
    it('should return terminal size from process.stdout', () => {
      // Given
      Object.defineProperty(process.stdout, 'columns', { value: 120, writable: true });
      Object.defineProperty(process.stdout, 'rows', { value: 40, writable: true });

      // When
      const size = getTerminalSize();

      // Then
      expect(size.cols).toBe(120);
      expect(size.rows).toBe(40);
    });

    it('should return defaults when terminal size is undefined', () => {
      // Given
      Object.defineProperty(process.stdout, 'columns', { value: undefined, writable: true });
      Object.defineProperty(process.stdout, 'rows', { value: undefined, writable: true });

      // When
      const size = getTerminalSize();

      // Then
      expect(size.cols).toBe(80);
      expect(size.rows).toBe(30);
    });
  });

  describe('reserveBottomLines()', () => {
    it('should write scroll region escape sequence', () => {
      // Given
      Object.defineProperty(process.stdout, 'rows', { value: 30, writable: true });
      const mockWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      // When
      reserveBottomLines(5);

      // Then
      expect(mockWrite).toHaveBeenCalled();
      const output = mockWrite.mock.calls.map((c) => c[0]).join('');
      expect(output).toBe('\x1b[1;25r'); // rows(30) - lineCount(5) = 25
    });

    it('should not write when lineCount is 0', () => {
      // Given
      const mockWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      // When
      reserveBottomLines(0);

      // Then
      expect(mockWrite).not.toHaveBeenCalled();
    });

    it('should not write when lineCount equals or exceeds rows', () => {
      // Given
      Object.defineProperty(process.stdout, 'rows', { value: 10, writable: true });
      const mockWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      // When
      reserveBottomLines(10);

      // Then
      expect(mockWrite).not.toHaveBeenCalled();
    });
  });

  describe('resetTerminalScrollRegion()', () => {
    it('should write reset scroll region escape sequence', () => {
      // Given
      const mockWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      // When
      resetTerminalScrollRegion();

      // Then
      expect(mockWrite).toHaveBeenCalledWith('\x1b[r');
    });
  });
});
