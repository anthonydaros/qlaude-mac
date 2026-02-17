import { describe, it, expect } from 'vitest';
import {
  COLORS,
  moveCursor,
  saveCursor,
  restoreCursor,
  clearLine,
  clearToEndOfLine,
  setScrollRegion,
  resetScrollRegion,
  stripAnsi,
} from '../../src/utils/ansi.js';

describe('ANSI utilities', () => {
  describe('COLORS', () => {
    it('should have correct RESET code', () => {
      expect(COLORS.RESET).toBe('\x1b[0m');
    });

    it('should have correct DIM code', () => {
      expect(COLORS.DIM).toBe('\x1b[2m');
    });

    it('should have correct CYAN code', () => {
      expect(COLORS.CYAN).toBe('\x1b[36m');
    });

    it('should have correct YELLOW code', () => {
      expect(COLORS.YELLOW).toBe('\x1b[33m');
    });

    it('should have correct GREEN code', () => {
      expect(COLORS.GREEN).toBe('\x1b[32m');
    });

    it('should have correct RED code', () => {
      expect(COLORS.RED).toBe('\x1b[31m');
    });
  });

  describe('moveCursor()', () => {
    it('should generate correct escape sequence', () => {
      // Given
      const row = 10;
      const col = 5;

      // When
      const result = moveCursor(row, col);

      // Then
      expect(result).toBe('\x1b[10;5H');
    });

    it('should handle row 1, col 1', () => {
      expect(moveCursor(1, 1)).toBe('\x1b[1;1H');
    });

    it('should handle large values', () => {
      expect(moveCursor(999, 999)).toBe('\x1b[999;999H');
    });
  });

  describe('saveCursor()', () => {
    it('should return ESC 7', () => {
      expect(saveCursor()).toBe('\x1b7');
    });
  });

  describe('restoreCursor()', () => {
    it('should return ESC 8', () => {
      expect(restoreCursor()).toBe('\x1b8');
    });
  });

  describe('clearLine()', () => {
    it('should return ESC[2K', () => {
      expect(clearLine()).toBe('\x1b[2K');
    });
  });

  describe('clearToEndOfLine()', () => {
    it('should return ESC[K', () => {
      expect(clearToEndOfLine()).toBe('\x1b[K');
    });
  });

  describe('setScrollRegion()', () => {
    it('should generate correct escape sequence', () => {
      // Given
      const top = 1;
      const bottom = 20;

      // When
      const result = setScrollRegion(top, bottom);

      // Then
      expect(result).toBe('\x1b[1;20r');
    });

    it('should handle different values', () => {
      expect(setScrollRegion(5, 25)).toBe('\x1b[5;25r');
    });
  });

  describe('resetScrollRegion()', () => {
    it('should return ESC[r', () => {
      expect(resetScrollRegion()).toBe('\x1b[r');
    });
  });

  describe('stripAnsi()', () => {
    it('should remove CSI color codes', () => {
      // Given
      const input = '\x1b[32mgreen text\x1b[0m';

      // When
      const result = stripAnsi(input);

      // Then
      expect(result).toBe('green text');
    });

    it('should remove cursor position codes', () => {
      // Given
      const input = '\x1b[10;5Htext at position';

      // When
      const result = stripAnsi(input);

      // Then
      expect(result).toBe('text at position');
    });

    it('should remove save/restore cursor codes', () => {
      // Given
      const input = '\x1b7saved\x1b8';

      // When
      const result = stripAnsi(input);

      // Then
      expect(result).toBe('saved');
    });

    it('should remove clear line codes', () => {
      // Given
      const input = '\x1b[2Kcleared line';

      // When
      const result = stripAnsi(input);

      // Then
      expect(result).toBe('cleared line');
    });

    it('should handle multiple ANSI codes', () => {
      // Given
      const input = '\x1b[1;32m\x1b[2Kbold green\x1b[0m normal\x1b[K';

      // When
      const result = stripAnsi(input);

      // Then
      expect(result).toBe('bold green normal');
    });

    it('should return empty string for ANSI-only input', () => {
      // Given
      const input = '\x1b[32m\x1b[0m\x1b7\x1b8';

      // When
      const result = stripAnsi(input);

      // Then
      expect(result).toBe('');
    });

    it('should pass through plain text unchanged', () => {
      // Given
      const input = 'plain text without ANSI';

      // When
      const result = stripAnsi(input);

      // Then
      expect(result).toBe('plain text without ANSI');
    });
  });
});
