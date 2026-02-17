import { logger } from './utils/logger.js';
import type { ParseResult } from './types/input.js';

// Queue commands
const QUEUE_NEW_SESSION_PREFIX = '>>> ';
const QUEUE_ADD_PREFIX = '>> ';
const QUEUE_REMOVE_PREFIX = '<<';
const QUEUE_BREAKPOINT_PREFIX = '>>#';

// Session label patterns: >>{Label:name} and >>{Load:name}
const QUEUE_LABEL_PATTERN = /^>>\{Label:([^}]+)\}$/i;
const QUEUE_LOAD_PATTERN = /^>>\{Load:([^}]+)\}$/i;
const QUEUE_NEW_SESSION_LOAD_PATTERN = /^>>>\{Load:([^}]+)\}(.*)$/i;  // Shorthand: >>> + >>{Load:name} + optional prompt

// Meta commands (colon prefix)
const META_COMMANDS = ['reload', 'status', 'pause', 'resume'] as const;

/**
 * Check if the input is a queue or meta command
 */
export function isQueueCommand(input: string): boolean {
  // Queue commands
  if (
    input.startsWith(QUEUE_NEW_SESSION_PREFIX) ||
    input.startsWith(QUEUE_BREAKPOINT_PREFIX) ||
    input.startsWith(QUEUE_ADD_PREFIX) ||
    input.startsWith(QUEUE_REMOVE_PREFIX)
  ) {
    return true;
  }

  // Session label commands
  if (QUEUE_LABEL_PATTERN.test(input) || QUEUE_LOAD_PATTERN.test(input) || QUEUE_NEW_SESSION_LOAD_PATTERN.test(input)) {
    return true;
  }

  // Meta commands (:command)
  if (input.startsWith(':')) {
    const cmd = input.slice(1).toLowerCase();
    return META_COMMANDS.includes(cmd as (typeof META_COMMANDS)[number]);
  }

  return false;
}

/**
 * Parse user input and determine command type
 */
export function parse(input: string): ParseResult {
  const rawInput = input;

  // Meta commands (:command) - check first
  if (input.startsWith(':')) {
    const cmd = input.slice(1).toLowerCase();
    switch (cmd) {
      case 'reload':
        logger.debug({ rawInput }, 'Parsed META_RELOAD command');
        return { type: 'META_RELOAD', rawInput };
      case 'status':
        logger.debug({ rawInput }, 'Parsed META_STATUS command');
        return { type: 'META_STATUS', rawInput };
      case 'pause':
        logger.debug({ rawInput }, 'Parsed META_PAUSE command');
        return { type: 'META_PAUSE', rawInput };
      case 'resume':
        logger.debug({ rawInput }, 'Parsed META_RESUME command');
        return { type: 'META_RESUME', rawInput };
    }
  }

  // Session Label command: >>{Label:name}
  const labelMatch = input.match(QUEUE_LABEL_PATTERN);
  if (labelMatch) {
    const label = labelMatch[1].trim();
    logger.debug({ label }, 'Parsed QUEUE_LABEL_SESSION command');
    return {
      type: 'QUEUE_LABEL_SESSION',
      label,
      rawInput,
    };
  }

  // New Session + Load shorthand: >>>{Load:name} or >>>{Load:name} prompt
  const newSessionLoadMatch = input.match(QUEUE_NEW_SESSION_LOAD_PATTERN);
  if (newSessionLoadMatch) {
    const label = newSessionLoadMatch[1].trim();
    const prompt = newSessionLoadMatch[2]?.trim() || undefined;
    logger.debug({ label, prompt: prompt || '(none)' }, 'Parsed QUEUE_LOAD_SESSION command (shorthand)');
    return {
      type: 'QUEUE_LOAD_SESSION',
      label,
      prompt,
      rawInput,
    };
  }

  // Session Load command: >>{Load:name}
  const loadMatch = input.match(QUEUE_LOAD_PATTERN);
  if (loadMatch) {
    const label = loadMatch[1].trim();
    logger.debug({ label }, 'Parsed QUEUE_LOAD_SESSION command');
    return {
      type: 'QUEUE_LOAD_SESSION',
      label,
      rawInput,
    };
  }

  // Breakpoint command: >># or >># comment (check before >>> and >>)
  if (input.startsWith(QUEUE_BREAKPOINT_PREFIX)) {
    const prompt = input.slice(QUEUE_BREAKPOINT_PREFIX.length).trim();
    logger.debug({ prompt: prompt || '(none)' }, 'Parsed QUEUE_BREAKPOINT command');
    return {
      type: 'QUEUE_BREAKPOINT',
      prompt: prompt || undefined,
      rawInput,
    };
  }

  // Queue New Session command: >>> or >>> prompt
  if (input === '>>>' || input.startsWith(QUEUE_NEW_SESSION_PREFIX)) {
    const prompt = input === '>>>' ? '' : input.slice(QUEUE_NEW_SESSION_PREFIX.length).trim();
    logger.debug({ prompt: prompt || '(empty)' }, 'Parsed QUEUE_NEW_SESSION command');
    return {
      type: 'QUEUE_NEW_SESSION',
      prompt: prompt || undefined,
      rawInput,
    };
  }

  // Queue Add command: >> prompt
  if (input.startsWith(QUEUE_ADD_PREFIX)) {
    const prompt = input.slice(QUEUE_ADD_PREFIX.length).trim();
    logger.debug({ prompt: prompt || '(empty)' }, 'Parsed QUEUE_ADD command');
    return {
      type: 'QUEUE_ADD',
      prompt: prompt || undefined,
      rawInput,
    };
  }

  // Queue Remove command: <<
  if (input.startsWith(QUEUE_REMOVE_PREFIX)) {
    logger.debug({ rawInput }, 'Parsed QUEUE_REMOVE command');
    return {
      type: 'QUEUE_REMOVE',
      rawInput,
    };
  }

  // Default: passthrough to Claude Code
  return {
    type: 'PASSTHROUGH',
    rawInput,
  };
}
