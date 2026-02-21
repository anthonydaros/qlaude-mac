import { describe, it, expect, vi } from 'vitest';
import { compilePatterns } from '../../src/utils/pattern-compiler.js';
import {
  DEFAULT_SELECTION_PROMPT_PATTERNS,
  DEFAULT_INTERRUPTED_PATTERNS,
  DEFAULT_TASK_FAILURE_PATTERNS,
  DEFAULT_TEXT_INPUT_KEYWORDS,
  DEFAULT_OPTION_PARSE_PATTERN,
  DEFAULT_TIP_FILTER_KEYWORDS,
  DEFAULT_PROMPT_SEPARATOR_PATTERN,
  DEFAULT_PROMPT_SEPARATOR_MIN_LENGTH,
} from '../../src/patterns/state-patterns.js';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

describe('compilePatterns', () => {
  describe('with no config', () => {
    it('should return all defaults', () => {
      const result = compilePatterns();

      expect(result.selectionPrompt.patterns).toBe(DEFAULT_SELECTION_PROMPT_PATTERNS);
      expect(result.interrupted.patterns).toBe(DEFAULT_INTERRUPTED_PATTERNS);
      expect(result.taskFailure.patterns).toBe(DEFAULT_TASK_FAILURE_PATTERNS);
      expect(result.textInputKeywords.patterns).toBe(DEFAULT_TEXT_INPUT_KEYWORDS);
      expect(result.optionParse.pattern).toBe(DEFAULT_OPTION_PARSE_PATTERN);
      expect(result.tipFilter.keywords).toBe(DEFAULT_TIP_FILTER_KEYWORDS);
      expect(result.promptSeparator.pattern).toBe(DEFAULT_PROMPT_SEPARATOR_PATTERN);
      expect(result.promptSeparator.minLength).toBe(DEFAULT_PROMPT_SEPARATOR_MIN_LENGTH);
    });
  });

  describe('with undefined config', () => {
    it('should return all defaults', () => {
      const result = compilePatterns(undefined);

      expect(result.selectionPrompt.patterns).toBe(DEFAULT_SELECTION_PROMPT_PATTERNS);
    });
  });

  describe('with empty config', () => {
    it('should return all defaults', () => {
      const result = compilePatterns({});

      expect(result.selectionPrompt.patterns).toBe(DEFAULT_SELECTION_PROMPT_PATTERNS);
      expect(result.interrupted.patterns).toBe(DEFAULT_INTERRUPTED_PATTERNS);
    });
  });

  describe('disabling via empty array', () => {
    it('should disable a category with empty patterns array', () => {
      const result = compilePatterns({
        interrupted: { patterns: [] },
      });

      expect(result.interrupted.patterns).toHaveLength(0);
    });

    it('should disable optionParse with empty string', () => {
      const result = compilePatterns({
        optionParse: { pattern: '' },
      });

      expect(result.optionParse.pattern).toBeNull();
    });

    it('should disable tipFilter with empty keywords', () => {
      const result = compilePatterns({
        tipFilter: { keywords: [] },
      });

      expect(result.tipFilter.keywords).toHaveLength(0);
    });

    it('should disable promptSeparator with empty string', () => {
      const result = compilePatterns({
        promptSeparator: { pattern: '' },
      });

      expect(result.promptSeparator.pattern).toBeNull();
    });
  });

  describe('disabling via enabled: false', () => {
    it('should disable multi-pattern category', () => {
      const result = compilePatterns({
        interrupted: { enabled: false },
      });

      expect(result.interrupted.patterns).toHaveLength(0);
    });

    it('should disable optionParse', () => {
      const result = compilePatterns({
        optionParse: { enabled: false },
      });

      expect(result.optionParse.pattern).toBeNull();
    });

    it('should disable tipFilter', () => {
      const result = compilePatterns({
        tipFilter: { enabled: false },
      });

      expect(result.tipFilter.keywords).toHaveLength(0);
    });

    it('should disable promptSeparator', () => {
      const result = compilePatterns({
        promptSeparator: { enabled: false },
      });

      expect(result.promptSeparator.pattern).toBeNull();
    });
  });

  describe('category present without patterns key uses defaults', () => {
    it('should use defaults when category object has no patterns key', () => {
      const result = compilePatterns({
        interrupted: {},
      });

      expect(result.interrupted.patterns).toBe(DEFAULT_INTERRUPTED_PATTERNS);
    });
  });

  describe('string pattern entries', () => {
    it('should compile string to RegExp', () => {
      const result = compilePatterns({
        selectionPrompt: {
          patterns: ['\\[Y/n\\]', 'custom-pattern'],
        },
      });

      expect(result.selectionPrompt.patterns).toHaveLength(2);
      expect(result.selectionPrompt.patterns[0]).toBeInstanceOf(RegExp);
      expect(result.selectionPrompt.patterns[0].test('[Y/n]')).toBe(true);
      expect(result.selectionPrompt.patterns[1].test('custom-pattern')).toBe(true);
    });
  });

  describe('object pattern entries with flags', () => {
    it('should compile with case-insensitive flag', () => {
      const result = compilePatterns({
        taskFailure: {
          patterns: [{ pattern: 'queue_stop', flags: 'i' }],
        },
      });

      expect(result.taskFailure.patterns).toHaveLength(1);
      expect(result.taskFailure.patterns[0].test('QUEUE_STOP')).toBe(true);
      expect(result.taskFailure.patterns[0].test('queue_stop')).toBe(true);
    });

    it('should compile with multiline flag', () => {
      const result = compilePatterns({
        interrupted: {
          patterns: [{ pattern: '^Interrupted$', flags: 'im' }],
        },
      });

      expect(result.interrupted.patterns[0].test('line1\nInterrupted\nline3')).toBe(true);
    });

    it('should default to no flags when flags omitted', () => {
      const result = compilePatterns({
        interrupted: {
          patterns: [{ pattern: 'test' }],
        },
      });

      expect(result.interrupted.patterns[0].flags).toBe('');
    });
  });

  describe('user patterns replace defaults', () => {
    it('should completely replace default patterns', () => {
      const result = compilePatterns({
        selectionPrompt: {
          patterns: ['my-custom-pattern'],
        },
      });

      // Should have only the custom pattern, not defaults
      expect(result.selectionPrompt.patterns).toHaveLength(1);
      expect(result.selectionPrompt.patterns[0].test('my-custom-pattern')).toBe(true);
      // Default pattern should not be present
      expect(result.selectionPrompt.patterns[0].test('[Y/n]')).toBe(false);
    });

    it('should not affect other categories', () => {
      const result = compilePatterns({
        selectionPrompt: {
          patterns: ['custom'],
        },
      });

      // Other categories should keep defaults
      expect(result.interrupted.patterns).toBe(DEFAULT_INTERRUPTED_PATTERNS);
    });
  });

  describe('single pattern configs', () => {
    it('should compile custom optionParse pattern', () => {
      const result = compilePatterns({
        optionParse: {
          pattern: '^(\\d+)\\)\\s+(.+)$',
        },
      });

      const match = '1) Option text'.match(result.optionParse.pattern!);
      expect(match).not.toBeNull();
      expect(match![1]).toBe('1');
      expect(match![2]).toBe('Option text');
    });

    it('should compile custom promptSeparator', () => {
      const result = compilePatterns({
        promptSeparator: {
          pattern: '^=+$',
          minLength: 5,
        },
      });

      expect(result.promptSeparator.pattern!.test('==========')).toBe(true);
      expect(result.promptSeparator.minLength).toBe(5);
    });

    it('should override tipFilter keywords', () => {
      const result = compilePatterns({
        tipFilter: {
          keywords: ['CustomTip:'],
        },
      });

      expect(result.tipFilter.keywords).toEqual(['CustomTip:']);
    });
  });

  describe('invalid regex', () => {
    it('should throw on invalid string pattern', () => {
      expect(() =>
        compilePatterns({
          selectionPrompt: {
            patterns: ['[invalid regex'],
          },
        })
      ).toThrow();
    });

    it('should throw on invalid object pattern', () => {
      expect(() =>
        compilePatterns({
          taskFailure: {
            patterns: [{ pattern: '(unclosed group', flags: '' }],
          },
        })
      ).toThrow();
    });
  });

  describe('mixed pattern entries', () => {
    it('should handle mix of string and object entries', () => {
      const result = compilePatterns({
        selectionPrompt: {
          patterns: [
            '\\[Y/n\\]',
            { pattern: '\\[y/N\\]', flags: 'i' },
            'simple-text',
          ],
        },
      });

      expect(result.selectionPrompt.patterns).toHaveLength(3);
      expect(result.selectionPrompt.patterns[0].test('[Y/n]')).toBe(true);
      expect(result.selectionPrompt.patterns[1].test('[y/n]')).toBe(true); // case insensitive
      expect(result.selectionPrompt.patterns[2].test('simple-text')).toBe(true);
    });
  });

  describe('empty patterns array disables category', () => {
    it('should return empty array instead of defaults', () => {
      const result = compilePatterns({
        selectionPrompt: {
          patterns: [],
        },
      });

      expect(result.selectionPrompt.patterns).toHaveLength(0);
    });
  });
});
