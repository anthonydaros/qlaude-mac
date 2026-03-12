import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SELECTION_PROMPT_PATTERNS,
  DEFAULT_INTERRUPTED_PATTERNS,
  SPINNER_PATTERN,
  DEFAULT_TASK_FAILURE_PATTERNS,
  DEFAULT_TEXT_INPUT_KEYWORDS,
  DEFAULT_OPTION_PARSE_PATTERN,
  DEFAULT_TIP_FILTER_KEYWORDS,
  DEFAULT_PROMPT_SEPARATOR_PATTERN,
  DEFAULT_PROMPT_SEPARATOR_MIN_LENGTH,
} from '../../src/patterns/state-patterns.js';

describe('Default State Patterns', () => {
  describe('SELECTION_PROMPT patterns', () => {
    const test = (input: string) =>
      DEFAULT_SELECTION_PROMPT_PATTERNS.some(p => p.test(input));

    it('should match [Y/n] format', () => {
      expect(test('Continue? [Y/n]')).toBe(true);
    });

    it('should match [y/N] format', () => {
      expect(test('Proceed? [y/N]')).toBe(true);
    });

    it('should match arrow cursor with numbered option', () => {
      expect(test('❯ 1. Yes, allow')).toBe(true);
    });

    it('should match Claude Code selection UI footer', () => {
      expect(test('Enter to select · ↑/↓ to navigate')).toBe(true);
    });

    it('should match tab navigation hint', () => {
      expect(test('←/→ or tab to cycle')).toBe(true);
    });

    it('should match > N. Option format', () => {
      expect(test('> 1. Yes')).toBe(true);
    });

    it('should NOT match regular text', () => {
      expect(test('Just some normal text')).toBe(false);
    });
  });

  describe('INTERRUPTED patterns', () => {
    const test = (input: string) =>
      DEFAULT_INTERRUPTED_PATTERNS.some(p => p.test(input));

    it('should match "Interrupted" on its own line', () => {
      expect(test('Interrupted')).toBe(true);
    });

    it('should match ^C', () => {
      expect(test('^C')).toBe(true);
    });

    it('should match "operation cancelled"', () => {
      expect(test('operation cancelled')).toBe(true);
    });

    it('should match "request aborted"', () => {
      expect(test('request aborted')).toBe(true);
    });

    it('should match "was interrupted"', () => {
      expect(test('The process was interrupted')).toBe(true);
    });
  });

  describe('SPINNER_PATTERN', () => {
    it('should match active spinner with ellipsis', () => {
      expect(SPINNER_PATTERN.test('✻ Zigzagging… (1m 18s)')).toBe(true);
    });

    it('should match spinner ending with ellipsis only', () => {
      expect(SPINNER_PATTERN.test('✻ Reading file…')).toBe(true);
    });

    it('should NOT match completed spinner (no ellipsis)', () => {
      expect(SPINNER_PATTERN.test('✻ Sautéed for 4m 42s')).toBe(false);
    });

    it('should NOT match footer line with mid-line separator', () => {
      expect(SPINNER_PATTERN.test('   Context left until auto-compact: 4% · /model opus[1m] for more context · Billed …')).toBe(false);
    });
  });

  describe('TASK_FAILURE patterns', () => {
    it('should match QUEUE_STOP', () => {
      const match = 'QUEUE_STOP\n'.match(DEFAULT_TASK_FAILURE_PATTERNS[0]);
      expect(match).not.toBeNull();
    });

    it('should match QUEUE_STOP with reason', () => {
      const match = 'QUEUE_STOP: manual intervention needed\n'.match(DEFAULT_TASK_FAILURE_PATTERNS[0]);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('manual intervention needed');
    });

    it('should match [QUEUE_STOP]', () => {
      const match = '[QUEUE_STOP]\n'.match(DEFAULT_TASK_FAILURE_PATTERNS[1]);
      expect(match).not.toBeNull();
    });

    it('should match rate limit message', () => {
      const match = "You've hit your limit".match(DEFAULT_TASK_FAILURE_PATTERNS[2]);
      expect(match).not.toBeNull();
    });

    it('should match rate limit with smart quote', () => {
      const match = "You\u2019ve hit your limit".match(DEFAULT_TASK_FAILURE_PATTERNS[2]);
      expect(match).not.toBeNull();
    });
  });

  describe('TEXT_INPUT_KEYWORDS patterns', () => {
    const test = (input: string) =>
      DEFAULT_TEXT_INPUT_KEYWORDS.some(p => p.test(input));

    it('should match "type" keyword', () => {
      expect(test('Type your answer')).toBe(true);
    });

    it('should match "custom" keyword', () => {
      expect(test('Custom input')).toBe(true);
    });

    it('should match trailing dots', () => {
      expect(test('Other...')).toBe(true);
    });

    it('should NOT match unrelated text', () => {
      expect(test('Yes, allow')).toBe(false);
    });
  });

  describe('OPTION_PARSE pattern', () => {
    it('should capture option number and text', () => {
      const match = '1. Yes, allow'.match(DEFAULT_OPTION_PARSE_PATTERN);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('1');
      expect(match![2]).toBe('Yes, allow');
    });

    it('should match with arrow cursor prefix', () => {
      const match = '❯ 2. No, deny'.match(DEFAULT_OPTION_PARSE_PATTERN);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('2');
      expect(match![2]).toBe('No, deny');
    });

    it('should match with > prefix', () => {
      const match = '> 3. Custom input...'.match(DEFAULT_OPTION_PARSE_PATTERN);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('3');
    });
  });

  describe('TIP_FILTER keywords', () => {
    it('should include ⎿ character', () => {
      expect(DEFAULT_TIP_FILTER_KEYWORDS).toContain('⎿');
    });

    it('should include Tip: string', () => {
      expect(DEFAULT_TIP_FILTER_KEYWORDS).toContain('Tip:');
    });
  });

  describe('PROMPT_SEPARATOR pattern', () => {
    it('should match horizontal separator line', () => {
      expect(DEFAULT_PROMPT_SEPARATOR_PATTERN.test('─────────────')).toBe(true);
    });

    it('should NOT match mixed content', () => {
      expect(DEFAULT_PROMPT_SEPARATOR_PATTERN.test('───abc───')).toBe(false);
    });

    it('should have minimum length of 10', () => {
      expect(DEFAULT_PROMPT_SEPARATOR_MIN_LENGTH).toBe(10);
    });
  });
});
