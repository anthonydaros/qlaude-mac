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
  });

  describe('buffering queue commands', () => {
    it('should start buffering on >', () => {
      const result = buffer.process('>');
      expect(result.action).toBe('echo');
      expect(result.data).toBe('>');
      expect(buffer.isActive()).toBe(true);
    });

    it('should start buffering on <', () => {
      const result = buffer.process('<');
      expect(result.action).toBe('echo');
      expect(result.data).toBe('<');
      expect(buffer.isActive()).toBe(true);
    });

    it('should continue buffering >> ', () => {
      buffer.process('>');
      buffer.process('>');
      const result = buffer.process(' ');
      expect(result.action).toBe('echo');
      expect(buffer.isActive()).toBe(true);
      expect(buffer.getBuffer()).toBe('>> ');
    });

    it('should flush buffer on Enter', () => {
      buffer.process('>');
      buffer.process('>');
      buffer.process(' ');
      buffer.process('t');
      buffer.process('e');
      buffer.process('s');
      buffer.process('t');

      const result = buffer.process('\r');
      expect(result.action).toBe('flush');
      expect(result.data).toBe('>> test');
      expect(buffer.isActive()).toBe(false);
    });

    it('should buffer << command', () => {
      buffer.process('<');
      buffer.process('<');

      const result = buffer.process('\r');
      expect(result.action).toBe('flush');
      expect(result.data).toBe('<<');
    });

    it('should buffer >>> command', () => {
      buffer.process('>');
      buffer.process('>');
      buffer.process('>');
      buffer.process(' ');
      buffer.process('x');

      const result = buffer.process('\r');
      expect(result.action).toBe('flush');
      expect(result.data).toBe('>>> x');
    });

    it('should buffer >>! command', () => {
      buffer.process('>');
      buffer.process('>');
      buffer.process('!');

      const result = buffer.process('\r');
      expect(result.action).toBe('flush');
      expect(result.data).toBe('>>!');
    });

    it('should buffer >>@ command', () => {
      buffer.process('>');
      buffer.process('>');
      buffer.process('@');

      const result = buffer.process('\r');
      expect(result.action).toBe('flush');
      expect(result.data).toBe('>>@');
    });
  });

  describe('non-command passthrough', () => {
    it('should passthrough when buffer does not match command pattern', () => {
      buffer.process('>');
      // After '>a', this doesn't match any queue command pattern
      const result = buffer.process('a');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe('>a');
      expect(buffer.isActive()).toBe(false);
    });

    it('should passthrough when buffer becomes invalid', () => {
      buffer.process('<');
      // After '<a', this doesn't match any queue command pattern
      const result = buffer.process('a');
      expect(result.action).toBe('passthrough');
      expect(result.data).toBe('<a');
      expect(buffer.isActive()).toBe(false);
    });
  });

  describe('special key handling', () => {
    it('should handle backspace while buffering', () => {
      buffer.process('>');
      buffer.process('>');
      buffer.process(' ');
      buffer.process('t');

      const result = buffer.process('\x7f'); // DEL
      expect(result.action).toBe('echo');
      expect(result.data).toBe('\x1b[D \x1b[D'); // ANSI: left, space, left
      expect(buffer.getBuffer()).toBe('>> ');
    });

    it('should stop buffering when backspace empties buffer', () => {
      buffer.process('>');

      buffer.process('\x7f'); // DEL
      expect(buffer.isActive()).toBe(false);
      expect(buffer.getBuffer()).toBe('');
    });

    it('should cancel buffering on Escape', () => {
      buffer.process('>');
      buffer.process('>');
      buffer.process(' ');

      const result = buffer.process('\x1b'); // ESC
      expect(result.action).toBe('cancel');
      expect(result.data).toBe('\x1b[D \x1b[D\x1b[D \x1b[D\x1b[D \x1b[D'); // erase 3 chars
      expect(result.passthrough).toBe('\x1b');
      expect(buffer.isActive()).toBe(false);
    });

    it('should cancel buffering on Ctrl+C', () => {
      buffer.process('>');
      buffer.process('>');

      const result = buffer.process('\x03'); // Ctrl+C
      expect(result.action).toBe('cancel');
      expect(result.data).toBe('\x1b[D \x1b[D\x1b[D \x1b[D'); // erase 2 chars
      expect(result.passthrough).toBe('\x03');
      expect(buffer.isActive()).toBe(false);
    });
  });

  describe('clear()', () => {
    it('should clear buffer and stop buffering', () => {
      buffer.process('>');
      buffer.process('>');
      buffer.process(' ');

      buffer.clear();

      expect(buffer.getBuffer()).toBe('');
      expect(buffer.isActive()).toBe(false);
    });
  });

  describe('complete command sequences', () => {
    it('should handle full >> prompt sequence', () => {
      const chars = '>> hello world';
      let lastResult;

      for (const char of chars) {
        lastResult = buffer.process(char);
      }

      // Flush with Enter
      const result = buffer.process('\r');
      expect(result.action).toBe('flush');
      expect(result.data).toBe('>> hello world');
    });

    it('should handle full << sequence', () => {
      buffer.process('<');
      buffer.process('<');

      const result = buffer.process('\r');
      expect(result.action).toBe('flush');
      expect(result.data).toBe('<<');
    });
  });
});
