/**
 * Display module for queue status bar rendering
 * Renders a fixed status bar at the top of the terminal (pure overlay, no PTY manipulation)
 */

import type { QueueItem, MessageType } from './types/index.js';
import {
  COLORS,
  saveCursor,
  restoreCursor,
  moveCursor,
  clearLine,
  clearToEndOfLine,
  stripAnsi,
} from './utils/ansi.js';

/**
 * Maximum number of items to display in status bar
 * Layout: 5 lines total (logo height), 3 items max on right side
 */
const MAX_DISPLAY_ITEMS = 3;

/**
 * ASCII art logo (5 lines) - displayed on left side
 */
const LOGO_LINES = [
  '\u2588\u2580\u2580\u2588 \u2588    \u2588\u2580\u2580\u2588 \u2588  \u2588 \u2588\u2580\u2580\u2584 \u2588\u2580\u2580',
  '\u2588  \u2588 \u2588    \u2588\u2580\u2580\u2588 \u2588  \u2588 \u2588  \u2588 \u2588\u2580\u2580',
  '\u2588  \u2588 \u2588    \u2588  \u2588 \u2588  \u2588 \u2588  \u2588 \u2588  ',
  '\u2588\u2584\u2580\u2588 \u2588\u2584\u2584\u2584 \u2588  \u2588 \u2580\u2584\u2584\u2580 \u2588\u2584\u2584\u2580 \u2588\u2584\u2584',
  '   \u2580                        ',
];

/**
 * Status bar height (fixed to match logo)
 */
const STATUS_BAR_HEIGHT = 5;

/**
 * Display class for rendering queue status bar at the top of terminal
 */
export class Display {
  private enabled: boolean = true;
  private lastHeight: number = 0;
  private currentMessage: { type: MessageType; text: string } | null = null;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;
  private lastItems: QueueItem[] = [];
  private isPaused: boolean = false;

  /**
   * Set the paused state for display
   */
  setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  /**
   * Update status bar with current queue items
   * Renders at the top of the terminal (row 1) as pure overlay
   */
  updateStatusBar(items: QueueItem[]): void {
    if (!this.enabled) return;

    // Store items for re-rendering with messages
    this.lastItems = items;

    const newHeight = STATUS_BAR_HEIGHT;

    // Save cursor position
    process.stdout.write(saveCursor());

    // Render status bar at top (starting from row 1)
    // Each line gets a background color and is padded to full terminal width
    const content = this.renderStatusBar(items);
    const lines = content.split('\n');
    const width = this.getTerminalWidth();
    const bg = COLORS.BG_STATUS_BAR;

    lines.forEach((line, index) => {
      // Re-apply BG after each RESET in the line content so background persists
      const lineWithBg = bg + line.replaceAll(COLORS.RESET, COLORS.RESET + bg);
      // Pad with spaces to fill the full terminal width
      const visibleLength = stripAnsi(line).length;
      const padding = Math.max(0, width - visibleLength);
      process.stdout.write(
        moveCursor(index + 1, 1) + lineWithBg + ' '.repeat(padding) + COLORS.RESET
      );
    });

    // Restore cursor position
    process.stdout.write(restoreCursor());

    // Update last height
    this.lastHeight = newHeight;
  }

  /**
   * Show a message in the status bar (on first line next to item count)
   */
  showMessage(type: MessageType, message: string): void {
    if (!this.enabled) return;

    // Clear any existing timer
    if (this.messageTimer) {
      clearTimeout(this.messageTimer);
    }

    // Store the message
    this.currentMessage = { type, text: message };

    // Re-render status bar with message
    this.updateStatusBar(this.lastItems);

    // Auto-clear message after 3 seconds
    this.messageTimer = setTimeout(() => {
      this.currentMessage = null;
      this.updateStatusBar(this.lastItems);
    }, 3000);
  }

  /**
   * Toggle status bar visibility
   * @returns Current enabled state after toggle
   */
  toggle(): boolean {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.clear();
    }
    return this.enabled;
  }

  /**
   * Clear status bar area
   */
  clear(): void {
    if (this.lastHeight === 0) return;

    // Save cursor position
    process.stdout.write(saveCursor());

    // Clear status bar area at top
    for (let i = 0; i < this.lastHeight; i++) {
      process.stdout.write(moveCursor(i + 1, 1) + clearLine());
    }

    // Restore cursor position
    process.stdout.write(restoreCursor());

    // Reset scroll region to full screen when status bar is cleared
    process.stdout.write('\x1b[r');

    this.lastHeight = 0;
  }

  /**
   * Render status bar content
   * Left side: ASCII art logo (5 lines)
   * Right side: Queue info (item count + items list)
   */
  private renderStatusBar(items: QueueItem[]): string {
    const lines: string[] = [];

    // Build right side content (5 lines to match logo)
    const rightLines: string[] = [];

    // Line 0: Item count + state + optional message
    let firstLine = '';
    if (items.length === 0) {
      firstLine = `${COLORS.DIM}[empty]${COLORS.RESET}`;
    } else {
      const itemWord = items.length === 1 ? 'item' : 'items';
      firstLine = `${COLORS.CYAN}[${items.length} ${itemWord}]${COLORS.RESET}`;
    }

    // Add paused/running state
    if (this.isPaused) {
      firstLine += ` ${COLORS.YELLOW}[paused]${COLORS.RESET}`;
    } else {
      firstLine += ` ${COLORS.GREEN}[running]${COLORS.RESET}`;
    }

    // Append message if present
    if (this.currentMessage) {
      const colors: Record<MessageType, string> = {
        info: COLORS.CYAN,
        success: COLORS.GREEN,
        warning: COLORS.YELLOW,
        error: COLORS.RED,
      };
      const color = colors[this.currentMessage.type] || COLORS.RESET;
      firstLine += ` ${color}${this.currentMessage.text}${COLORS.RESET}`;
    }
    rightLines.push(firstLine);

    // Lines 1-3: Queue items
    const displayItems = items.slice(0, MAX_DISPLAY_ITEMS);
    displayItems.forEach((item, index) => {
      rightLines.push(this.formatQueueItem(item, index));
    });

    // "..and N more" indicator
    if (items.length > MAX_DISPLAY_ITEMS) {
      const moreCount = items.length - MAX_DISPLAY_ITEMS;
      rightLines.push(`${COLORS.DIM}..and ${moreCount} more${COLORS.RESET}`);
    }

    // Pad right side to 5 lines
    while (rightLines.length < 5) {
      rightLines.push('');
    }

    // Combine logo (left) + separator + queue info (right)
    for (let i = 0; i < 5; i++) {
      const logoLine = `${COLORS.LIGHT_BLUE}${LOGO_LINES[i]}${COLORS.RESET}`;
      const separator = `${COLORS.DIM}\u2502${COLORS.RESET}`;
      lines.push(`${logoLine} ${separator} ${rightLines[i]}`);
    }

    return lines.join('\n');
  }

  /**
   * Format a single queue item for display
   */
  private formatQueueItem(item: QueueItem, index: number): string {
    const width = this.getTerminalWidth();
    const prefix = ` ${index + 1}. `;

    // Build tag based on item type
    let tag = '';
    let tagLength = 0;

    if (item.isBreakpoint) {
      tag = `${COLORS.RED}[BP]${COLORS.RESET} `;
      tagLength = 5; // "[BP] "
    } else if (item.labelSession) {
      tag = `${COLORS.GREEN}[LABEL:${item.labelSession}]${COLORS.RESET} `;
      tagLength = 9 + item.labelSession.length; // "[LABEL:name] "
    } else if (item.loadSessionLabel) {
      tag = `${COLORS.MAGENTA}[LOAD:${item.loadSessionLabel}]${COLORS.RESET} `;
      tagLength = 8 + item.loadSessionLabel.length; // "[LOAD:name] "
    } else if (item.isNewSession) {
      tag = `${COLORS.YELLOW}[NEW]${COLORS.RESET} `;
      tagLength = 6; // "[NEW] "
    }

    // Add multiline indicator (can combine with [NEW])
    if (item.isMultiline) {
      tag = `${COLORS.CYAN}[ML]${COLORS.RESET} ${tag}`;
      tagLength += 5; // "[ML] "
    }

    // Breakpoints and labels without prompts don't need "(no prompt)" display
    if ((item.isBreakpoint || item.labelSession) && !item.prompt) {
      return `${COLORS.DIM}${prefix}${COLORS.RESET}${tag.trimEnd()}`;
    }

    // Calculate available space for prompt
    const availableWidth = width - prefix.length - tagLength - 1;
    let prompt = item.prompt || '(no prompt)';

    // For multiline prompts, show first line only
    if (prompt.includes('\n')) {
      const lines = prompt.split('\n');
      const firstLine = lines[0].replace(/\r$/, ''); // Remove trailing \r (Windows)
      const lineCount = lines.length;
      prompt = `${firstLine} (+${lineCount - 1} lines)`;
    }

    // Truncate if needed
    if (prompt.length > availableWidth) {
      prompt = prompt.substring(0, availableWidth - 3) + '...';
    }

    return `${COLORS.DIM}${prefix}${COLORS.RESET}${tag}${prompt}`;
  }

  /**
   * Get current terminal width
   */
  private getTerminalWidth(): number {
    return process.stdout.columns || 80;
  }

  /**
   * Get current status bar height
   */
  getHeight(): number {
    return this.lastHeight;
  }
}
