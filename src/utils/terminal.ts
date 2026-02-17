/**
 * Terminal utilities for size detection and scroll region management
 */

import { setScrollRegion, resetScrollRegion } from './ansi.js';

/**
 * Terminal size dimensions
 */
export interface TerminalSize {
  cols: number;
  rows: number;
}

/**
 * Get current terminal size
 * @returns Terminal dimensions, defaults to 80x30 if unavailable
 */
export function getTerminalSize(): TerminalSize {
  return {
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 30,
  };
}

/**
 * Reserve bottom lines for status bar by setting scroll region
 * @param lineCount Number of lines to reserve at bottom
 */
export function reserveBottomLines(lineCount: number): void {
  const { rows } = getTerminalSize();
  if (lineCount > 0 && lineCount < rows) {
    const scrollBottom = rows - lineCount;
    process.stdout.write(setScrollRegion(1, scrollBottom));
  }
}

/**
 * Reset scroll region to full terminal
 */
export function resetTerminalScrollRegion(): void {
  process.stdout.write(resetScrollRegion());
}
