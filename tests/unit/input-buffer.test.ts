import { describe, it, expect, beforeEach } from 'vitest';
import { InputBuffer } from '../../src/utils/input-buffer.js';

describe('InputBuffer', () => {
  let buffer: InputBuffer;

  beforeEach(() => {
    buffer = new InputBuffer();
  });

  describe('basic passthrough', () => {
    it('should passthrough regular characters', () => {
      const result = buffer.process('a');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe('a');
    });

    it('should passthrough Enter when not buffering', () => {
      const result = buffer.process('\r');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe('\r');
    });

    it('should passthrough special characters', () => {
      const result = buffer.process('$');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe('$');
    });
  });

  describe('no shortcut buffering (shortcuts removed)', () => {
    it('should passthrough > character (no buffering)', () => {
      const result = buffer.process('>');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe('>');
      expect(buffer.isActive()).toBe(false);
    });

    it('should passthrough < character (no buffering)', () => {
      const result = buffer.process('<');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe('<');
      expect(buffer.isActive()).toBe(false);
    });

    it('should passthrough : character (queue mode handled by main.ts)', () => {
      const result = buffer.process(':');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe(':');
      expect(buffer.isActive()).toBe(false);
    });

    it('should passthrough @ character', () => {
      const result = buffer.process('@');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe('@');
      expect(buffer.isActive()).toBe(false);
    });
  });

  describe('special key handling (not buffering)', () => {
    it('should passthrough backspace when not buffering', () => {
      const result = buffer.process('\x7f');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe('\x7f');
    });

    it('should passthrough Escape when not buffering', () => {
      const result = buffer.process('\x1b');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe('\x1b');
    });

    it('should passthrough Ctrl+C when not buffering', () => {
      const result = buffer.process('\x03');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe('\x03');
    });
  });

  describe('clear()', () => {
    it('should clear buffer', () => {
      buffer.clear();
      expect(buffer.getBuffer()).toBe('');
      expect(buffer.isActive()).toBe(false);
    });
  });

  describe('all input passthroughs (no buffering logic)', () => {
    it('should passthrough any sequence of characters', () => {
      for (const char of 'hello world') {
        const result = buffer.process(char);
        expect(result.action).toBe('passthrough');
        expect(result.data).toBe(char);
      }
    });

    it('should passthrough Enter after regular characters', () => {
      buffer.process('a');
      buffer.process('b');
      const result = buffer.process('\r');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe('\r');
    });
  });
});
