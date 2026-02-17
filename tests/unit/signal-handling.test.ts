import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCleanup } from '../../src/utils/cleanup.js';

describe('Signal Handling', () => {
  describe('cleanup function', () => {
    let mockSetRawMode: ReturnType<typeof vi.fn>;
    let mockPtyWrapper: { isRunning: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> };
    let mockStdin: { isTTY: boolean; setRawMode: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockSetRawMode = vi.fn();
      mockPtyWrapper = {
        isRunning: vi.fn().mockReturnValue(false),
        kill: vi.fn(),
      };
      mockStdin = { isTTY: true, setRawMode: mockSetRawMode };
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should set raw mode to false if stdin is TTY', () => {
      // Given
      mockStdin.isTTY = true;
      const cleanup = createCleanup(mockPtyWrapper, undefined, mockStdin);

      // When
      cleanup();

      // Then
      expect(mockSetRawMode).toHaveBeenCalledWith(false);
    });

    it('should not set raw mode if stdin is not TTY', () => {
      // Given
      mockStdin.isTTY = false;
      const cleanup = createCleanup(mockPtyWrapper, undefined, mockStdin);

      // When
      cleanup();

      // Then
      expect(mockSetRawMode).not.toHaveBeenCalled();
    });

    it('should kill PTY if running', () => {
      // Given
      mockPtyWrapper.isRunning.mockReturnValue(true);
      const cleanup = createCleanup(mockPtyWrapper, undefined, mockStdin);

      // When
      cleanup();

      // Then
      expect(mockPtyWrapper.kill).toHaveBeenCalled();
    });

    it('should not kill PTY if not running', () => {
      // Given
      mockPtyWrapper.isRunning.mockReturnValue(false);
      const cleanup = createCleanup(mockPtyWrapper, undefined, mockStdin);

      // When
      cleanup();

      // Then
      expect(mockPtyWrapper.kill).not.toHaveBeenCalled();
    });

    it('should only run once (prevent duplicate cleanup)', () => {
      // Given
      mockPtyWrapper.isRunning.mockReturnValue(true);
      const cleanup = createCleanup(mockPtyWrapper, undefined, mockStdin);

      // When
      cleanup();
      cleanup();
      cleanup();

      // Then - kill should only be called once
      expect(mockPtyWrapper.kill).toHaveBeenCalledTimes(1);
      expect(mockSetRawMode).toHaveBeenCalledTimes(1);
    });
  });
});
