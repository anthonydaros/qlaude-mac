/**
 * ANSI escape sequence utilities for terminal control
 */

/**
 * ANSI color codes
 */
export const COLORS = {
  RESET: '\x1b[0m',
  DIM: '\x1b[2m',
  CYAN: '\x1b[36m',
  YELLOW: '\x1b[33m',
  GREEN: '\x1b[32m',
  RED: '\x1b[31m',
  MAGENTA: '\x1b[35m',
  LIGHT_BLUE: '\x1b[94m',
  BG_STATUS_BAR: '\x1b[48;5;236m', // dark gray background for status bar
} as const;

/**
 * Move cursor to specified position
 * @param row Row number (1-indexed)
 * @param col Column number (1-indexed)
 */
export function moveCursor(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

/**
 * Save cursor position (ESC 7)
 */
export function saveCursor(): string {
  return '\x1b7';
}

/**
 * Restore cursor position (ESC 8)
 */
export function restoreCursor(): string {
  return '\x1b8';
}

/**
 * Clear entire line (ESC[2K)
 */
export function clearLine(): string {
  return '\x1b[2K';
}

/**
 * Clear from cursor to end of line (ESC[K)
 */
export function clearToEndOfLine(): string {
  return '\x1b[K';
}

/**
 * Set scroll region
 * @param top Top row (1-indexed)
 * @param bottom Bottom row (1-indexed)
 */
export function setScrollRegion(top: number, bottom: number): string {
  return `\x1b[${top};${bottom}r`;
}

/**
 * Reset scroll region to full screen
 */
export function resetScrollRegion(): string {
  return '\x1b[r';
}

/**
 * Regular expression to match ANSI escape sequences
 * Matches:
 * - CSI sequences: ESC [ ... letter (e.g., \x1b[32m, \x1b[1;2H, \x1b[?2026h)
 * - OSC sequences: ESC ] ... BEL/ST (Operating System Command)
 * - Simple escapes: ESC 7, ESC 8, etc. (save/restore cursor)
 * - Control characters: \x1b followed by single char
 */
const ANSI_REGEX = /\x1b(?:\[[?]?[0-9;]*[a-zA-Z]|\][^\x07]*\x07|[78]|.)/g;

/**
 * Strip all ANSI escape sequences from text
 * @param text Text containing ANSI escape sequences
 * @returns Clean text without ANSI codes
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}
