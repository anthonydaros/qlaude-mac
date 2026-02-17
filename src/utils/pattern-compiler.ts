/**
 * Compiles JSON pattern config strings into RegExp objects.
 * Merges with defaults when config is partially specified.
 *
 * Semantics:
 * - Category absent from config → use defaults
 * - enabled: false → disable the category
 * - patterns present and non-empty → replace defaults
 * - patterns present and empty ([]) → disable the category
 * - Single pattern ("") → disable
 */

import type { PatternEntry, PatternCategoryConfig, PatternsConfig } from '../types/config.js';
import {
  DEFAULT_SELECTION_PROMPT_PATTERNS,
  DEFAULT_INTERRUPTED_PATTERNS,
  DEFAULT_SPINNER_PATTERNS,
  DEFAULT_TASK_FAILURE_PATTERNS,
  DEFAULT_TEXT_INPUT_KEYWORDS,
  DEFAULT_OPTION_PARSE_PATTERN,
  DEFAULT_TIP_FILTER_KEYWORDS,
  DEFAULT_PROMPT_SEPARATOR_PATTERN,
  DEFAULT_PROMPT_SEPARATOR_MIN_LENGTH,
} from '../patterns/state-patterns.js';
import { logger } from './logger.js';

/**
 * Compiled patterns ready for use by StateDetector.
 * Empty arrays / null patterns mean the category is disabled.
 */
export interface CompiledPatterns {
  selectionPrompt: { patterns: RegExp[] };
  interrupted: { patterns: RegExp[] };
  spinner: { patterns: RegExp[] };
  taskFailure: { patterns: RegExp[] };
  textInputKeywords: { patterns: RegExp[] };
  optionParse: { pattern: RegExp | null };
  tipFilter: { keywords: string[] };
  promptSeparator: { pattern: RegExp | null; minLength: number };
}

/**
 * Convert a PatternEntry (string or {pattern, flags}) to RegExp.
 * Throws on invalid regex — user is expected to fix their config.
 */
function compileEntry(entry: PatternEntry): RegExp {
  if (typeof entry === 'string') {
    return new RegExp(entry);
  }
  return new RegExp(entry.pattern, entry.flags ?? '');
}

/**
 * Compile a pattern category from config, falling back to defaults.
 * - config absent → defaults
 * - enabled: false → disabled (empty array)
 * - config.patterns absent → defaults
 * - config.patterns = [] → disabled (empty array)
 * - config.patterns = [...] → compiled user patterns
 */
function compileCategory(
  config: PatternCategoryConfig | undefined,
  defaults: RegExp[],
): { patterns: RegExp[] } {
  if (!config) {
    return { patterns: defaults };
  }
  if (config.enabled === false) {
    return { patterns: [] };
  }
  // patterns key absent → use defaults
  if (config.patterns === undefined) {
    return { patterns: defaults };
  }
  // patterns = [] → disabled
  if (config.patterns.length === 0) {
    return { patterns: [] };
  }
  // patterns = [...] → compile user patterns
  const patterns = config.patterns.map(compileEntry);
  return { patterns };
}

/**
 * Compile all patterns from config, merging with defaults.
 * If config is undefined, returns all defaults.
 */
export function compilePatterns(config?: PatternsConfig): CompiledPatterns {
  const defaults: CompiledPatterns = {
    selectionPrompt: { patterns: DEFAULT_SELECTION_PROMPT_PATTERNS },
    interrupted: { patterns: DEFAULT_INTERRUPTED_PATTERNS },
    spinner: { patterns: DEFAULT_SPINNER_PATTERNS },
    taskFailure: { patterns: DEFAULT_TASK_FAILURE_PATTERNS },
    textInputKeywords: { patterns: DEFAULT_TEXT_INPUT_KEYWORDS },
    optionParse: { pattern: DEFAULT_OPTION_PARSE_PATTERN },
    tipFilter: { keywords: DEFAULT_TIP_FILTER_KEYWORDS },
    promptSeparator: {
      pattern: DEFAULT_PROMPT_SEPARATOR_PATTERN,
      minLength: DEFAULT_PROMPT_SEPARATOR_MIN_LENGTH,
    },
  };

  if (!config) {
    return defaults;
  }

  logger.info('Compiling custom patterns from config');

  // Compile optionParse
  let optionParsePattern: RegExp | null = DEFAULT_OPTION_PARSE_PATTERN;
  if (config.optionParse) {
    if (config.optionParse.enabled === false || config.optionParse.pattern === '') {
      optionParsePattern = null; // disabled
    } else if (config.optionParse.pattern) {
      optionParsePattern = new RegExp(config.optionParse.pattern, config.optionParse.flags ?? '');
    }
  }

  // Compile promptSeparator
  let promptSeparatorPattern: RegExp | null = DEFAULT_PROMPT_SEPARATOR_PATTERN;
  if (config.promptSeparator) {
    if (config.promptSeparator.enabled === false || config.promptSeparator.pattern === '') {
      promptSeparatorPattern = null; // disabled
    } else if (config.promptSeparator.pattern) {
      promptSeparatorPattern = new RegExp(config.promptSeparator.pattern);
    }
  }

  // Compile tipFilter
  let tipFilterKeywords: string[] = DEFAULT_TIP_FILTER_KEYWORDS;
  if (config.tipFilter) {
    if (config.tipFilter.enabled === false) {
      tipFilterKeywords = [];
    } else if (config.tipFilter.keywords) {
      tipFilterKeywords = config.tipFilter.keywords;
    }
  }

  return {
    selectionPrompt: compileCategory(config.selectionPrompt, DEFAULT_SELECTION_PROMPT_PATTERNS),
    interrupted: compileCategory(config.interrupted, DEFAULT_INTERRUPTED_PATTERNS),
    spinner: compileCategory(config.spinner, DEFAULT_SPINNER_PATTERNS),
    taskFailure: compileCategory(config.taskFailure, DEFAULT_TASK_FAILURE_PATTERNS),
    textInputKeywords: compileCategory(config.textInputKeywords, DEFAULT_TEXT_INPUT_KEYWORDS),
    optionParse: {
      pattern: optionParsePattern,
    },
    tipFilter: {
      keywords: tipFilterKeywords,
    },
    promptSeparator: {
      pattern: promptSeparatorPattern,
      minLength: config.promptSeparator?.minLength ?? DEFAULT_PROMPT_SEPARATOR_MIN_LENGTH,
    },
  };
}
