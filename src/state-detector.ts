/**
 * State detector for Claude Code output analysis
 * Uses idle-based detection with pattern matching for blocking states
 */

import { EventEmitter } from 'events';
import type { StateType, ClaudeCodeState, StateMetadata, ParsedOption } from './types/state.js';
import { logger } from './utils/logger.js';
import { DEFAULT_CONFIG } from './types/config.js';
import type { CompiledPatterns } from './utils/pattern-compiler.js';
import { compilePatterns } from './utils/pattern-compiler.js';
import { SPINNER_PATTERN } from './patterns/state-patterns.js';

/**
 * Function that returns screen content for pattern analysis
 */
export type ScreenContentProvider = () => string[];

/**
 * Configuration options for StateDetector
 */
export interface StateDetectorConfig {
  idleThresholdMs?: number;
  requiredStableChecks?: number;
  screenContentProvider?: ScreenContentProvider;
  patterns?: CompiledPatterns;
}

/**
 * StateDetector analyzes Claude Code's PTY output to detect state changes
 *
 * Detection strategy:
 * 1. When output is received → PROCESSING
 * 2. When no output for idleThresholdMs → analyze screen for patterns
 *    - If blocking pattern detected → SELECTION_PROMPT / INTERRUPTED
 *    - Otherwise → READY
 */
export class StateDetector extends EventEmitter {
  private readonly idleThresholdMs: number;
  private readonly requiredStableChecks: number;
  private readonly patterns: CompiledPatterns;
  private screenContentProvider: ScreenContentProvider | null = null;

  private currentState: ClaudeCodeState;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastOutputTime: number = 0;
  private lastScreenSnapshot: string = '';
  private consecutiveStableChecks: number = 0;
  private lastFailureMarkerCount: number = 0;
  private lastFailureReason: string | undefined;

  constructor(config: StateDetectorConfig = {}) {
    super();
    this.idleThresholdMs = config.idleThresholdMs ?? DEFAULT_CONFIG.idleThresholdMs;
    this.requiredStableChecks = config.requiredStableChecks ?? DEFAULT_CONFIG.requiredStableChecks;
    this.patterns = config.patterns ?? compilePatterns();
    this.screenContentProvider = config.screenContentProvider ?? null;
    this.currentState = {
      type: 'PROCESSING',
      timestamp: Date.now(),
    };
    logger.debug({ idleThresholdMs: this.idleThresholdMs }, 'StateDetector initialized');
  }

  /**
   * Set the screen content provider for pattern analysis
   */
  setScreenContentProvider(provider: ScreenContentProvider): void {
    this.screenContentProvider = provider;
  }

  /**
   * Analyze a chunk of PTY output
   * Any output means Claude is processing; idle triggers pattern analysis
   */
  analyze(_chunk: string): void {
    this.lastOutputTime = Date.now();

    // Clear existing idle timer
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }

    // If we were in a non-PROCESSING state and got output, transition to PROCESSING
    if (this.currentState.type !== 'PROCESSING') {
      this.transitionTo('PROCESSING');
    }

    // Start idle timer - when idle, analyze screen for patterns
    this.idleTimer = setTimeout(() => {
      this.handleIdleTimeout();
    }, this.idleThresholdMs);
  }

  /**
   * Handle idle timeout - analyze screen and determine state
   * Uses screen stability check to prevent false READY detection
   */
  private handleIdleTimeout(): void {
    const idleMs = Date.now() - this.lastOutputTime;
    logger.debug({ idleMs }, 'Idle timeout reached, analyzing screen');

    // Get screen content for analysis
    const screenContent = this.screenContentProvider?.() ?? [];
    const content = screenContent.join('\n');

    // Debug: log screen content being analyzed
    logger.debug({ screenContent, contentLength: content.length }, 'Screen content for analysis');

    const detectedState = this.detectStateFromScreen(screenContent);

    // For READY state, require screen stability (no changes between checks)
    if (detectedState === 'READY') {
      if (content !== this.lastScreenSnapshot) {
        // Screen changed - reset stability counter and wait more
        this.consecutiveStableChecks = 0;
        this.lastScreenSnapshot = content;
        logger.debug(
          {
            reason: 'SCREEN_CHANGED',
            currentState: this.currentState.type,
            contentPreview: content.slice(-200)
          },
          'READY transition blocked: screen content changed, resetting stability counter'
        );

        // Schedule another check
        this.idleTimer = setTimeout(() => {
          this.handleIdleTimeout();
        }, this.idleThresholdMs);
        return;
      }

      // Screen is same as last check
      this.consecutiveStableChecks++;
      logger.debug(
        { consecutiveStableChecks: this.consecutiveStableChecks, required: this.requiredStableChecks },
        'Screen stable, checking stability count'
      );

      if (this.consecutiveStableChecks < this.requiredStableChecks) {
        // Not enough stable checks yet, schedule another
        logger.debug(
          {
            reason: 'STABILITY_CHECK_PENDING',
            current: this.consecutiveStableChecks,
            required: this.requiredStableChecks,
            currentState: this.currentState.type
          },
          'READY transition blocked: waiting for more stability checks'
        );
        this.idleTimer = setTimeout(() => {
          this.handleIdleTimeout();
        }, this.idleThresholdMs);
        return;
      }

      // Enough stable checks - but check for spinner first
      if (this.hasSpinnerPattern(content)) {
        // Spinner detected - don't transition to READY, keep waiting
        logger.debug(
          {
            reason: 'SPINNER_DETECTED',
            stableChecks: this.consecutiveStableChecks,
            currentState: this.currentState.type
          },
          'READY transition blocked: spinner detected, continuing to wait'
        );
        this.idleTimer = setTimeout(() => {
          this.handleIdleTimeout();
        }, this.idleThresholdMs);
        return;
      }

      logger.debug(
        {
          stableChecks: this.consecutiveStableChecks,
          currentState: this.currentState.type,
          contentPreview: content.slice(-300)
        },
        'Screen stable for required duration, transitioning to READY'
      );
    }

    // Reset stability tracking when transitioning
    this.consecutiveStableChecks = 0;
    this.lastScreenSnapshot = '';

    if (this.currentState.type !== detectedState) {
      logger.debug(
        { detectedState, screenLines: screenContent.length },
        'State detected from screen analysis'
      );

      // Parse options if SELECTION_PROMPT detected
      const metadata: StateMetadata = {
        bufferSnapshot: content,
      };

      if (detectedState === 'SELECTION_PROMPT') {
        metadata.options = this.parseOptionsFromScreen(screenContent);
        logger.debug({ options: metadata.options }, 'Parsed options from screen');
      }

      // Check for spinner patterns when transitioning to READY
      if (detectedState === 'READY') {
        metadata.hasSpinner = this.hasSpinnerPattern(content);
      }

      // Extract failure reason for TASK_FAILED state (cached from detectStateFromScreen)
      if (detectedState === 'TASK_FAILED') {
        metadata.failureReason = this.lastFailureReason;
      }

      this.transitionTo(detectedState, metadata);
    }
  }

  /**
   * Check if option text indicates text input is required
   */
  private isTextInputOption(text: string): boolean {
    return this.patterns.textInputKeywords.patterns.some(pattern => pattern.test(text));
  }

  /**
   * Parse numbered options from screen content
   * Matches patterns like "1. Option text" or "❯ 1. Option text"
   */
  private parseOptionsFromScreen(lines: string[]): ParsedOption[] {
    if (!this.patterns.optionParse.pattern) return [];

    const options: ParsedOption[] = [];
    const seenNumbers = new Set<number>();

    // Parse bottom-to-top so the MOST RECENT selection prompt (at screen bottom)
    // takes priority when multiple prompts are visible on screen
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].match(this.patterns.optionParse.pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        const text = match[2].trim();
        // Avoid duplicates — bottom (most recent) wins
        if (!seenNumbers.has(num) && text.length > 0) {
          seenNumbers.add(num);
          options.push({
            number: num,
            text,
            isTextInput: this.isTextInputOption(text),
          });
        }
      }
    }

    // Sort by number
    options.sort((a, b) => a.number - b.number);

    return options;
  }

  /**
   * Filter out prompt input lines between horizontal separator lines.
   * Claude Code UI renders the input area as: ────\n❯ <user input>\n────
   * User input text can match blocking patterns (e.g., "approve"), causing false positives.
   */
  private filterPromptInputLines(lines: string[]): string[] {
    const sepPattern = this.patterns.promptSeparator.pattern;
    if (!sepPattern) return lines;

    const { minLength } = this.patterns.promptSeparator;
    const isSeparator = (line: string): boolean => {
      return line.length >= minLength && sepPattern.test(line);
    };

    return lines.filter((line, i) => {
      if (i > 0 && i < lines.length - 1 && isSeparator(lines[i - 1]) && isSeparator(lines[i + 1])) {
        return false;
      }
      return true;
    });
  }

  /**
   * Detect state from screen content using pattern matching
   */
  private detectStateFromScreen(lines: string[]): StateType {
    // Check for TASK_FAILED first (highest priority) using unfiltered content
    // Rate limit messages like "You've hit your limit" appear on ⎿ lines,
    // so they must be checked before Tip/⎿ line filtering
    if (this.patterns.taskFailure.patterns.length > 0) {
      const unfilteredContent = lines.join('\n');
      if (this.detectTaskFailure(unfilteredContent).failed) {
        return 'TASK_FAILED';
      }
    }

    // Filter out Tip lines to avoid false positives (e.g., "pre-approve", "pre-deny")
    const filteredLines = this.patterns.tipFilter.keywords.length > 0
      ? lines.filter(line => !this.patterns.tipFilter.keywords.some(kw => line.includes(kw)))
      : lines;
    // Filter out prompt input lines between ──── separators to avoid matching user-typed text
    const promptFiltered = this.filterPromptInputLines(filteredLines);
    const content = promptFiltered.join('\n');

    // Check for INTERRUPTED
    const interruptedMatch = this.findMatchingPattern(content, this.patterns.interrupted.patterns);
    if (interruptedMatch) {
      logger.debug(
        { pattern: interruptedMatch.pattern, matched: interruptedMatch.matched },
        'INTERRUPTED pattern detected'
      );
      return 'INTERRUPTED';
    }

    // Check for SELECTION_PROMPT
    const selectionMatch = this.findMatchingPattern(content, this.patterns.selectionPrompt.patterns);
    if (selectionMatch) {
      logger.debug(
        { pattern: selectionMatch.pattern, matched: selectionMatch.matched },
        'SELECTION_PROMPT pattern detected'
      );
      return 'SELECTION_PROMPT';
    }

    // Default to READY - spinner check in handleIdleTimeout will block if still processing
    return 'READY';
  }

  /**
   * Find the first matching pattern and return details
   */
  private findMatchingPattern(
    content: string,
    patterns: RegExp[]
  ): { pattern: string; matched: string } | null {
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        return { pattern: pattern.toString(), matched: match[0] };
      }
    }
    return null;
  }

  /**
   * Detect task failure from explicit QUEUE_STOP marker using count-based comparison.
   * Only triggers when the number of failure markers on screen INCREASES,
   * preventing repeated triggers from the same marker persisting on screen.
   * When markers scroll off (count decreases), lastFailureMarkerCount is updated
   * so a genuinely new marker will be detected when it appears.
   */
  private detectTaskFailure(content: string): { failed: boolean; reason?: string } {
    const lines = content.split('\n');
    let currentCount = 0;
    let lastReason: string | undefined;

    for (const line of lines) {
      for (const pattern of this.patterns.taskFailure.patterns) {
        const match = line.match(pattern);
        if (match) {
          currentCount++;
          lastReason = match[1]?.trim() || lastReason;
          break; // count each line once
        }
      }
    }

    const previousCount = this.lastFailureMarkerCount;
    this.lastFailureMarkerCount = currentCount;

    if (currentCount > previousCount) {
      logger.debug({ currentCount, previousCount, reason: lastReason }, 'QUEUE_STOP marker count increased');
      this.lastFailureReason = lastReason;
      return { failed: true, reason: lastReason };
    }

    return { failed: false };
  }

  /**
   * Check if screen contains an active spinner line.
   * Checks each line individually so ^ and $ anchors work correctly.
   */
  private hasSpinnerPattern(content: string): boolean {
    for (const line of content.split('\n')) {
      const match = line.match(SPINNER_PATTERN);
      if (match) {
        logger.debug({ matchedText: match[0], matchedLine: line }, 'Spinner pattern matched');
        return true;
      }
    }
    return false;
  }

  /**
   * Get current state
   */
  getState(): ClaudeCodeState {
    return { ...this.currentState };
  }

  /**
   * Check if Claude Code is ready for queue execution
   * Returns true only when in READY state
   */
  isReadyForQueue(): boolean {
    return this.currentState.type === 'READY';
  }

  /**
   * Reset state to initial (PROCESSING)
   * Starts a fresh idle timer to ensure we can transition to READY
   */
  reset(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.lastOutputTime = Date.now();
    this.lastScreenSnapshot = '';
    this.consecutiveStableChecks = 0;
    this.lastFailureMarkerCount = 0;
    this.transitionTo('PROCESSING');

    // Start idle timer to ensure we can detect READY state
    // even if no more PTY output comes after reset
    this.idleTimer = setTimeout(() => {
      this.handleIdleTimeout();
    }, this.idleThresholdMs);
  }

  /**
   * Force immediate transition to READY state (no timer delay)
   * Use for :resume command where we know we want to execute immediately
   */
  forceReady(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.lastOutputTime = Date.now();
    this.lastScreenSnapshot = '';
    this.consecutiveStableChecks = 0;
    this.transitionTo('READY');
  }

  /**
   * Transition to a new state and emit event
   */
  private transitionTo(newState: StateType, metadata?: StateMetadata): void {
    const previousState = this.currentState.type;
    this.currentState = {
      type: newState,
      timestamp: Date.now(),
      metadata,
    };

    logger.debug({ from: previousState, to: newState }, 'State transition');
    this.emit('state_change', this.getState());
  }

  /**
   * Clean up timers
   */
  dispose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

// Re-export types for convenience
export type { StateType, ClaudeCodeState };
