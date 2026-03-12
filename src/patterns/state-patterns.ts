/**
 * Default state detection patterns for Claude Code output analysis.
 * These are used when no custom patterns are provided in .qlaude/patterns.json.
 *
 * Users can override any of these by specifying patterns in
 * .qlaude/patterns.json. User-specified patterns completely replace
 * defaults (no merging).
 */

// -- Selection prompt detection --

export const DEFAULT_SELECTION_PROMPT_PATTERNS: RegExp[] = [
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /❯\s*\d+\.\s/,                      // Arrow cursor with numbered option
  /Enter to select · ↑\/↓ to navigate/,  // Claude Code selection UI footer
  /←\/→ or tab to cycle/,
  /^\s*>\s*\d+\.\s+\w+/m,
];

// -- Interrupted detection --

export const DEFAULT_INTERRUPTED_PATTERNS: RegExp[] = [
  /^Interrupted$/im,
  /\^C/,
  /operation cancelled/i,
  /request aborted/i,
  /was interrupted/i,
];

// -- Spinner detection --

// Claude Code spinner: line starts with spinner char and ends with ellipsis (with optional parenthesized info like duration/tokens)
export const SPINNER_PATTERN: RegExp = /^\s*[*·✢✳∗✻✽✶].*…(?:\s*\(.*\))?\s*$/;

// -- Task failure detection --

export const DEFAULT_TASK_FAILURE_PATTERNS: RegExp[] = [
  /QUEUE_STOP(?::\s*(.+?))?(?:\n|$)/i,  // QUEUE_STOP or QUEUE_STOP: reason
  /\[QUEUE_STOP\](?:\s*(.+?))?(?:\n|$)/, // [QUEUE_STOP] or [QUEUE_STOP] reason
  /You['\u2019]ve hit your limit/i,      // Rate limit message (exact Claude Code message)
];

// -- Text input keyword detection (for selection options) --

export const DEFAULT_TEXT_INPUT_KEYWORDS: RegExp[] = [
  /\btype\b/i,
  /\benter\b/i,
  /\binput\b/i,
  /\bcustom\b/i,
  /\bspecify\b/i,
  /\bother\b/i,
  /\.{2,}$/,            // Ends with "..." or ".."
];

// -- Option parsing pattern --

export const DEFAULT_OPTION_PARSE_PATTERN: RegExp = /^[\s❯>]*(\d+)\.\s+(.+)$/;

// -- Tip line filter keywords (substring match, not regex) --

export const DEFAULT_TIP_FILTER_KEYWORDS: string[] = ['⎿', 'Tip:'];

// -- Prompt separator detection --

export const DEFAULT_PROMPT_SEPARATOR_PATTERN: RegExp = /^─+$/;
export const DEFAULT_PROMPT_SEPARATOR_MIN_LENGTH = 10;
