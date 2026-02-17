/**
 * Input buffer for handling raw mode input
 * Buffers characters until Enter is pressed, then determines
 * whether to parse as queue command or pass through to PTY
 *
 * Actions:
 * - 'passthrough': Send to PTY (normal input)
 * - 'echo': Echo to stdout only, don't send to PTY (buffering)
 * - 'flush': Buffer complete, return buffered content
 * - 'buffer': Continue buffering, no output needed
 * - 'cancel': Erase echoed content (data) then pass key to PTY (passthrough)
 */
export class InputBuffer {
  private buffer: string = '';
  private isBuffering: boolean = false;

  /**
   * Process a single character or chunk of input
   * Returns action to take and data to output
   */
  process(input: string): {
    action: 'buffer' | 'flush' | 'passthrough' | 'echo' | 'cancel';
    data?: string;
    passthrough?: string;
  } {
    // Handle special keys
    if (input === '\r' || input === '\n') {
      // Enter pressed - flush buffer if buffering
      if (this.isBuffering) {
        const buffered = this.buffer;
        this.clear();
        return { action: 'flush', data: buffered };
      }
      // Not buffering, pass through Enter
      return { action: 'passthrough', data: input };
    }

    // Backspace handling (DEL or BS)
    if (input === '\x7f' || input === '\x08') {
      if (this.isBuffering && this.buffer.length > 0) {
        this.buffer = this.buffer.slice(0, -1);
        // If buffer is empty after backspace, stop buffering
        if (this.buffer.length === 0) {
          this.isBuffering = false;
        }
        // Use ANSI escape: move left, space, move left
        return { action: 'echo', data: '\x1b[D \x1b[D' };
      }
      return { action: 'passthrough', data: input };
    }

    // Escape or Ctrl+C - cancel buffering
    if (input === '\x1b' || input === '\x03') {
      if (this.isBuffering) {
        // Erase what we echoed to stdout before passing to PTY
        // Use ANSI escape: move left, space, move left for each char
        const eraseSequence = '\x1b[D \x1b[D'.repeat(this.buffer.length);
        this.clear();
        // Echo erase sequence then pass the key to PTY
        return { action: 'cancel', data: eraseSequence, passthrough: input };
      }
      return { action: 'passthrough', data: input };
    }

    // Check if this could start a queue command
    if (!this.isBuffering) {
      if (input === '>' || input === '<') {
        // Start buffering - might be a queue command
        this.isBuffering = true;
        this.buffer = input;
        // Echo the character to stdout only (not to PTY)
        return { action: 'echo', data: input };
      }
      // Not a potential command, pass through to PTY
      return { action: 'passthrough', data: input };
    }

    // Already buffering - continue
    this.buffer += input;

    // Check if buffer could still be a queue command
    if (this.couldBeQueueCommand(this.buffer)) {
      // Echo the character to stdout only and continue buffering
      return { action: 'echo', data: input };
    }

    // Buffer doesn't look like a queue command anymore
    // Flush everything as passthrough
    const buffered = this.buffer;
    this.clear();
    return { action: 'passthrough', data: buffered };
  }

  /**
   * Check if the partial input could still become a queue command
   */
  private couldBeQueueCommand(partial: string): boolean {
    // Queue command patterns:
    // >> (add), >>> (new session), >>! (reload), >>@ (toggle), << (remove)
    const patterns = ['>> ', '>>> ', '>>!', '>>@', '<<'];

    for (const pattern of patterns) {
      // Check if partial matches start of pattern
      if (pattern.startsWith(partial)) {
        return true;
      }
      // Check if partial starts with a complete pattern prefix
      if (partial.startsWith(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Clear the buffer
   */
  clear(): void {
    this.buffer = '';
    this.isBuffering = false;
  }

  /**
   * Get current buffer contents
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Check if currently buffering
   */
  isActive(): boolean {
    return this.isBuffering;
  }
}
