/**
 * TerminalEmulator - Uses @xterm/headless to properly emulate terminal behavior
 *
 * This class wraps xterm's headless terminal to accurately track the current
 * input line, handling all ANSI escape sequences correctly.
 */
import pkg from '@xterm/headless';
const { Terminal } = pkg;
import { logger } from './logger.js';

export class TerminalEmulator {
  private term: InstanceType<typeof Terminal>;

  constructor(cols: number = 80, rows: number = 30) {
    this.term = new Terminal({
      cols,
      rows,
      allowProposedApi: true,
    });
    logger.debug({ cols, rows }, 'TerminalEmulator initialized');
  }

  /**
   * Write PTY output data to the terminal emulator
   */
  write(data: string): void {
    this.term.write(data);
  }

  /**
   * Get the current line where the cursor is positioned
   * @returns The text content of the current line, trimmed
   */
  getCurrentLine(): string {
    try {
      const buffer = this.term.buffer.active;
      if (!buffer) {
        logger.warn('Terminal buffer not available');
        return '';
      }

      const cursorY = buffer.cursorY;
      const line = buffer.getLine(cursorY);

      if (!line) {
        return '';
      }

      // translateToString(true) trims trailing whitespace
      const text = line.translateToString(true);
      logger.trace({ cursorY, text }, 'getCurrentLine');
      return text;
    } catch (err) {
      logger.error({ err }, 'Error getting current line');
      return '';
    }
  }

  /**
   * Get the last N lines from the terminal viewport
   * @param n Number of lines to retrieve
   * @returns Array of line contents
   */
  getLastLines(n: number): string[] {
    try {
      const buffer = this.term.buffer.active;
      if (!buffer) {
        logger.debug('getLastLines: buffer not available');
        return [];
      }

      const lines: string[] = [];
      const rows = this.term.rows;
      const baseY = buffer.baseY; // Scroll offset

      // Read entire viewport - simpler and avoids edge cases with partial ranges
      for (let y = 0; y < rows; y++) {
        const line = buffer.getLine(baseY + y);
        if (line) {
          lines.push(line.translateToString(true));
        }
      }

      // Pad with empty lines if we got fewer than n lines
      while (lines.length < n) {
        lines.unshift('');
      }

      return lines;
    } catch (err) {
      logger.error({ err }, 'Error getting last lines');
      return [];
    }
  }

  /**
   * Get the cursor X position (column)
   */
  getCursorX(): number {
    try {
      return this.term.buffer.active?.cursorX ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Get the cursor Y position (row)
   */
  getCursorY(): number {
    try {
      return this.term.buffer.active?.cursorY ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Resize the terminal
   */
  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows);
    logger.debug({ cols, rows }, 'TerminalEmulator resized');
  }

  /**
   * Clear the terminal (reset state)
   */
  clear(): void {
    this.term.reset();
  }

  /**
   * Dispose of the terminal instance
   */
  dispose(): void {
    this.term.dispose();
    logger.debug('TerminalEmulator disposed');
  }
}
