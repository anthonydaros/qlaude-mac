import { describe, it, expect } from 'vitest';
import { parse, isQueueCommand } from '../../src/input-parser.js';

describe('InputParser', () => {
  describe('parse() - :command form', () => {
    // :add
    it('should parse ":add prompt" as QUEUE_ADD', () => {
      const result = parse(':add test prompt');
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('test prompt');
    });

    it('should parse ":ADD" (uppercase) as QUEUE_ADD', () => {
      const result = parse(':ADD hello');
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('hello');
    });

    it('should handle ":add" without prompt (returns undefined)', () => {
      const result = parse(':add');
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBeUndefined();
    });

    // :drop
    it('should parse ":drop" as QUEUE_REMOVE', () => {
      expect(parse(':drop').type).toBe('QUEUE_REMOVE');
    });

    // :clear
    it('should parse ":clear" as QUEUE_CLEAR', () => {
      expect(parse(':clear').type).toBe('QUEUE_CLEAR');
    });

    // :save
    it('should parse ":save name" as QUEUE_SAVE_SESSION', () => {
      const result = parse(':save checkpoint-v1');
      expect(result.type).toBe('QUEUE_SAVE_SESSION');
      expect(result.label).toBe('checkpoint-v1');
    });

    it('should handle ":save" without name (label undefined)', () => {
      const result = parse(':save');
      expect(result.type).toBe('QUEUE_SAVE_SESSION');
      expect(result.label).toBeUndefined();
    });

    // :load (standalone, no inline prompt)
    it('should parse ":load name" as QUEUE_LOAD_SESSION', () => {
      const result = parse(':load checkpoint-v1');
      expect(result.type).toBe('QUEUE_LOAD_SESSION');
      expect(result.label).toBe('checkpoint-v1');
      expect(result.prompt).toBeUndefined();
    });

    it('should parse ":load name extra" — label is full args', () => {
      const result = parse(':load checkpoint-v1 continue work');
      expect(result.type).toBe('QUEUE_LOAD_SESSION');
      expect(result.label).toBe('checkpoint-v1 continue work');
      expect(result.prompt).toBeUndefined();
    });

    it('should handle ":load" without name (label undefined)', () => {
      const result = parse(':load');
      expect(result.type).toBe('QUEUE_LOAD_SESSION');
      expect(result.label).toBeUndefined();
    });

    // :model
    it('should parse ":model opus" as META_MODEL', () => {
      const result = parse(':model opus');
      expect(result.type).toBe('META_MODEL');
      expect(result.label).toBe('opus');
    });

    it('should handle ":model" without name (label undefined)', () => {
      const result = parse(':model');
      expect(result.type).toBe('META_MODEL');
      expect(result.label).toBeUndefined();
    });

    it('should parse ":MODEL Sonnet" (uppercase) as META_MODEL', () => {
      const result = parse(':MODEL Sonnet');
      expect(result.type).toBe('META_MODEL');
      expect(result.label).toBe('Sonnet');
    });

    // System commands
    it('should parse ":reload" as META_RELOAD', () => {
      expect(parse(':reload').type).toBe('META_RELOAD');
    });

    it('should parse ":RELOAD" (uppercase) as META_RELOAD', () => {
      expect(parse(':RELOAD').type).toBe('META_RELOAD');
    });

    it('should parse ":status" as META_STATUS', () => {
      expect(parse(':status').type).toBe('META_STATUS');
    });

    it('should parse ":pause" as META_PAUSE', () => {
      expect(parse(':pause').type).toBe('META_PAUSE');
    });

    it('should parse ":resume" as META_RESUME', () => {
      expect(parse(':resume').type).toBe('META_RESUME');
    });

    it('should parse ":help" as META_HELP', () => {
      expect(parse(':help').type).toBe('META_HELP');
    });

    it('should parse ":list" as META_LIST', () => {
      expect(parse(':list').type).toBe('META_LIST');
    });
  });

  describe('parse() - no shortcuts', () => {
    it('should NOT parse "> prompt" as QUEUE_ADD (shortcuts removed)', () => {
      expect(parse('> test prompt').type).toBe('PASSTHROUGH');
    });

    it('should NOT parse ">>" as QUEUE_NEW_SESSION (shortcuts removed)', () => {
      expect(parse('>>').type).toBe('PASSTHROUGH');
    });

    it('should NOT parse ">> prompt" as QUEUE_NEW_SESSION (shortcuts removed)', () => {
      expect(parse('>> test').type).toBe('PASSTHROUGH');
    });

    it('should NOT parse "<" as QUEUE_REMOVE (shortcuts removed)', () => {
      expect(parse('<').type).toBe('PASSTHROUGH');
    });

    it('should NOT parse "< " as QUEUE_REMOVE (shortcuts removed)', () => {
      expect(parse('< ').type).toBe('PASSTHROUGH');
    });
  });

  describe('parse() - removed commands', () => {
    it('should NOT parse ":bp" as a command (bp removed)', () => {
      expect(parse(':bp').type).toBe('PASSTHROUGH');
    });

    it('should NOT parse ":bp comment" as a command (bp removed)', () => {
      expect(parse(':bp check here').type).toBe('PASSTHROUGH');
    });

    it('should NOT parse ":new" as a command (new removed, use :add @new)', () => {
      expect(parse(':new').type).toBe('PASSTHROUGH');
    });

    it('should NOT parse ":del" as a command (del removed, use :drop)', () => {
      expect(parse(':del').type).toBe('PASSTHROUGH');
    });
  });

  describe('parse() - :add with @ directives', () => {
    it('should parse ":add @new" as QUEUE_ADD with prompt "@new"', () => {
      const result = parse(':add @new');
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('@new');
    });

    it('should parse ":add @pause reason" as QUEUE_ADD', () => {
      const result = parse(':add @pause check here');
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('@pause check here');
    });

    it('should parse ":add @save name" as QUEUE_ADD', () => {
      const result = parse(':add @save checkpoint');
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('@save checkpoint');
    });

    it('should parse ":add @load name" as QUEUE_ADD', () => {
      const result = parse(':add @load checkpoint');
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('@load checkpoint');
    });

    it('should parse ":add \\@text" as QUEUE_ADD (escaped @)', () => {
      const result = parse(':add \\@username');
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('\\@username');
    });
  });

  describe('parse() - passthrough', () => {
    it('should return PASSTHROUGH for regular input', () => {
      const result = parse('regular input text');
      expect(result.type).toBe('PASSTHROUGH');
      expect(result.rawInput).toBe('regular input text');
    });

    it('should return PASSTHROUGH for unknown :command', () => {
      expect(parse(':unknown').type).toBe('PASSTHROUGH');
    });

    it('should return PASSTHROUGH for ":something random"', () => {
      expect(parse(':foobar hello').type).toBe('PASSTHROUGH');
    });

    it('should preserve rawInput on all results', () => {
      const input = ':add test';
      expect(parse(input).rawInput).toBe(input);
    });
  });

  describe('parse() - edge cases', () => {
    it('should handle :add with special characters', () => {
      const result = parse(':add prompt with $pecial ch@rs!');
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe('prompt with $pecial ch@rs!');
    });

    it('should handle :add as escape for : prompts', () => {
      const result = parse(':add :new something');
      expect(result.type).toBe('QUEUE_ADD');
      expect(result.prompt).toBe(':new something');
    });
  });

  describe('isQueueCommand()', () => {
    // :commands
    it('should return true for ":add prompt"', () => {
      expect(isQueueCommand(':add test')).toBe(true);
    });

    it('should return true for ":drop"', () => {
      expect(isQueueCommand(':drop')).toBe(true);
    });

    it('should return true for ":save name"', () => {
      expect(isQueueCommand(':save name')).toBe(true);
    });

    it('should return true for ":load name"', () => {
      expect(isQueueCommand(':load name')).toBe(true);
    });

    it('should return true for ":clear"', () => {
      expect(isQueueCommand(':clear')).toBe(true);
    });

    it('should return true for ":reload"', () => {
      expect(isQueueCommand(':reload')).toBe(true);
    });

    it('should return true for ":status"', () => {
      expect(isQueueCommand(':status')).toBe(true);
    });

    it('should return true for ":pause"', () => {
      expect(isQueueCommand(':pause')).toBe(true);
    });

    it('should return true for ":resume"', () => {
      expect(isQueueCommand(':resume')).toBe(true);
    });

    it('should return true for ":help"', () => {
      expect(isQueueCommand(':help')).toBe(true);
    });

    it('should return true for ":list"', () => {
      expect(isQueueCommand(':list')).toBe(true);
    });

    // Shortcuts removed
    it('should return false for "> prompt" (shortcuts removed)', () => {
      expect(isQueueCommand('> test')).toBe(false);
    });

    it('should return false for ">>" (shortcuts removed)', () => {
      expect(isQueueCommand('>>')).toBe(false);
    });

    it('should return false for "<" (shortcuts removed)', () => {
      expect(isQueueCommand('<')).toBe(false);
    });

    it('should return false for ":bp" (bp removed)', () => {
      expect(isQueueCommand(':bp')).toBe(false);
    });

    it('should return false for ":new" (new removed)', () => {
      expect(isQueueCommand(':new')).toBe(false);
    });

    it('should return false for ":del" (del removed)', () => {
      expect(isQueueCommand(':del')).toBe(false);
    });

    // Passthrough
    it('should return false for regular input', () => {
      expect(isQueueCommand('regular input')).toBe(false);
    });

    it('should return false for empty input', () => {
      expect(isQueueCommand('')).toBe(false);
    });

    it('should return false for unknown :command', () => {
      expect(isQueueCommand(':unknown')).toBe(false);
    });
  });
});
