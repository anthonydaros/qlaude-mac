import { describe, it, expect } from 'vitest';
import { parse, isQueueCommand } from '../../src/input-parser.js';

describe('InputParser', () => {
  describe('parse()', () => {
    it('should parse >> command as QUEUE_ADD', () => {
      // Given
      const input = '>> test prompt';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('test prompt');
      expect(result.rawInput).toBe(input);
    });

    it('should handle empty prompt after >> (returns undefined prompt)', () => {
      // Given
      const input = '>> ';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBeUndefined();
      expect(result.rawInput).toBe(input);
    });

    it('should return PASSTHROUGH for >> without space', () => {
      // Given
      const input = '>>';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('PASSTHROUGH');
      expect(result.prompt).toBeUndefined();
      expect(result.rawInput).toBe(input);
    });

    it('should return PASSTHROUGH for >>text without space', () => {
      // Given
      const input = '>>test';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('PASSTHROUGH');
      expect(result.prompt).toBeUndefined();
      expect(result.rawInput).toBe(input);
    });

    it('should return PASSTHROUGH for regular input', () => {
      // Given
      const input = 'regular input text';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('PASSTHROUGH');
      expect(result.prompt).toBeUndefined();
      expect(result.rawInput).toBe(input);
    });

    it('should return PASSTHROUGH for single > input', () => {
      // Given
      const input = '> test';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('PASSTHROUGH');
      expect(result.prompt).toBeUndefined();
      expect(result.rawInput).toBe(input);
    });

    it('should trim whitespace from prompt', () => {
      // Given - '>> ' followed by spaces and text
      const input = '>>   test with spaces   ';

      // When
      const result = parse(input);

      // Then - starts with '>> ' so it's QUEUE_ADD with trimmed prompt
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('test with spaces');
    });

    it('should handle prompt with special characters', () => {
      // Given
      const input = '>> prompt with $pecial ch@rs!';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('prompt with $pecial ch@rs!');
    });

    it('should handle multiline prompt (takes first line only)', () => {
      // Given
      const input = '>> line1\nline2';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('line1\nline2');
    });

    // QUEUE_NEW_SESSION tests (Story 2.4)
    it('should parse >>> command as QUEUE_NEW_SESSION', () => {
      // Given
      const input = '>>> test prompt';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_NEW_SESSION');
      expect(result.prompt).toBe('test prompt');
      expect(result.rawInput).toBe(input);
    });

    it('should handle empty prompt after >>> (returns undefined prompt)', () => {
      // Given
      const input = '>>> ';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_NEW_SESSION');
      expect(result.prompt).toBeUndefined();
      expect(result.rawInput).toBe(input);
    });

    it('should return QUEUE_NEW_SESSION for >>> without space', () => {
      // Given
      const input = '>>>';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_NEW_SESSION');
      expect(result.prompt).toBeUndefined(); // No prompt, just new session
      expect(result.rawInput).toBe(input);
    });

    it('should return PASSTHROUGH for >>>text without space', () => {
      // Given
      const input = '>>>test';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('PASSTHROUGH');
      expect(result.prompt).toBeUndefined();
      expect(result.rawInput).toBe(input);
    });

    it('should return QUEUE_ADD for >> > (space before third >)', () => {
      // Given
      const input = '>> >';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('>');
      expect(result.rawInput).toBe(input);
    });

    // META_RELOAD tests (colon commands)
    it('should parse :reload command as META_RELOAD', () => {
      // Given
      const input = ':reload';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('META_RELOAD');
      expect(result.rawInput).toBe(input);
    });

    it('should parse :RELOAD (uppercase) as META_RELOAD', () => {
      // Given
      const input = ':RELOAD';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('META_RELOAD');
      expect(result.rawInput).toBe(input);
    });

    // META_STATUS tests
    it('should parse :status command as META_STATUS', () => {
      // Given
      const input = ':status';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('META_STATUS');
      expect(result.rawInput).toBe(input);
    });

    // META_PAUSE tests
    it('should parse :pause command as META_PAUSE', () => {
      // Given
      const input = ':pause';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('META_PAUSE');
      expect(result.rawInput).toBe(input);
    });

    // META_RESUME tests
    it('should parse :resume command as META_RESUME', () => {
      // Given
      const input = ':resume';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('META_RESUME');
      expect(result.rawInput).toBe(input);
    });

    it('should return PASSTHROUGH for unknown :command', () => {
      // Given
      const input = ':unknown';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('PASSTHROUGH');
      expect(result.rawInput).toBe(input);
    });

    it('should parse ">> !" as QUEUE_ADD with prompt "!"', () => {
      // Given
      const input = '>> !';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('!');
    });

    it('should parse ">> @" as QUEUE_ADD with prompt "@"', () => {
      // Given
      const input = '>> @';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('@');
    });

    // QUEUE_REMOVE tests (Story 2.3)
    it('should parse << command as QUEUE_REMOVE', () => {
      // Given
      const input = '<<';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_REMOVE');
      expect(result.rawInput).toBe(input);
    });

    it('should parse << with trailing space as QUEUE_REMOVE', () => {
      // Given
      const input = '<< ';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_REMOVE');
      expect(result.rawInput).toBe(input);
    });

    it('should parse << with trailing text as QUEUE_REMOVE', () => {
      // Given
      const input = '<<abc';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('QUEUE_REMOVE');
      expect(result.rawInput).toBe(input);
    });

    it('should return PASSTHROUGH for single <', () => {
      // Given
      const input = '<';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('PASSTHROUGH');
      expect(result.rawInput).toBe(input);
    });

    it('should return PASSTHROUGH for < < with space between', () => {
      // Given
      const input = '< <';

      // When
      const result = parse(input);

      // Then
      expect(result.type).toBe('PASSTHROUGH');
      expect(result.rawInput).toBe(input);
    });
  });

  describe('isQueueCommand()', () => {
    it('should return true for >> command with content', () => {
      expect(isQueueCommand('>> test')).toBe(true);
    });

    it('should return true for >> command with only space', () => {
      expect(isQueueCommand('>> ')).toBe(true);
    });

    it('should return false for regular input', () => {
      expect(isQueueCommand('regular input')).toBe(false);
    });

    it('should return false for >> without space', () => {
      expect(isQueueCommand('>>')).toBe(false);
    });

    it('should return false for >>text without space', () => {
      expect(isQueueCommand('>>test')).toBe(false);
    });

    it('should return false for single > input', () => {
      expect(isQueueCommand('> test')).toBe(false);
    });

    it('should return false for empty input', () => {
      expect(isQueueCommand('')).toBe(false);
    });

    // QUEUE_REMOVE tests (Story 2.3)
    it('should return true for << command', () => {
      expect(isQueueCommand('<<')).toBe(true);
    });

    it('should return false for single <', () => {
      expect(isQueueCommand('<')).toBe(false);
    });

    it('should return false for < < with space between', () => {
      expect(isQueueCommand('< <')).toBe(false);
    });

    // QUEUE_NEW_SESSION tests (Story 2.4)
    it('should return true for >>> command with content', () => {
      expect(isQueueCommand('>>> test')).toBe(true);
    });

    it('should return true for >>> command with only space', () => {
      expect(isQueueCommand('>>> ')).toBe(true);
    });

    it('should return false for >>> without space', () => {
      expect(isQueueCommand('>>>')).toBe(false);
    });

    // META commands (colon prefix)
    it('should return true for :reload command', () => {
      expect(isQueueCommand(':reload')).toBe(true);
    });

    it('should return true for :status command', () => {
      expect(isQueueCommand(':status')).toBe(true);
    });

    it('should return true for :pause command', () => {
      expect(isQueueCommand(':pause')).toBe(true);
    });

    it('should return true for :resume command', () => {
      expect(isQueueCommand(':resume')).toBe(true);
    });

    it('should return false for unknown :command', () => {
      expect(isQueueCommand(':unknown')).toBe(false);
    });
  });
});
