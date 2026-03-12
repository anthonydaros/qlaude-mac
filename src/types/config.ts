/**
 * Configuration types for qlaude
 */

/**
 * Telegram notification configuration
 */
export interface TelegramConfig {
  /**
   * Enable Telegram notifications
   * @default false
   */
  enabled: boolean;

  /**
   * Telegram Bot API token
   */
  botToken: string;

  /**
   * Telegram chat ID to send notifications to
   */
  chatId: string;

  /**
   * Delay (ms) before confirming Telegram updates, allowing multi-instance polling.
   * Higher values give more instances time to see each update.
   * Set to 0 for single-instance mode (original behavior).
   * @default 30000
   */
  confirmDelayMs?: number;

  /**
   * Per-notification-type layout templates.
   * Available types: selection_prompt, interrupted, breakpoint, queue_started,
   * queue_completed, task_failed, pty_crashed, default.
   *
   * Common variables (all types):
   *   {title} — event title, {hostname}, {ip}, {instanceId}, {project}, {queueLength}
   * Type-specific variables:
   *   breakpoint: {reason} — pause reason
   *   task_failed: {error} — failure message
   *   pty_crashed: {recovery} — recovery status
   *   selection_prompt: {context} — screen context (code block), {options} — option list
   *
   * All variables are raw data (MarkdownV2-escaped). Add your own emojis and formatting.
   * Lines that become empty after substitution are automatically removed.
   */
  templates?: Record<string, string>;
}

/**
 * Conversation log configuration
 */
export interface ConversationLogConfig {
  /**
   * Enable conversation logging
   * @default false
   */
  enabled: boolean;

  /**
   * Log file path (relative to .qlaude/ directory or absolute)
   * @default 'conversation.log'
   */
  filePath: string;

  /**
   * Include timestamps in log entries
   * @default true
   */
  timestamps: boolean;
}

/**
 * Log level options
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

/**
 * Pattern entry: plain string (no flags) or object with explicit flags
 * Examples: "\\[Y/n\\]" or { "pattern": "\\[Y/n\\]", "flags": "i" }
 */
export type PatternEntry = string | { pattern: string; flags?: string };

/**
 * Pattern category config.
 * - enabled: false → disable the category entirely
 * - If patterns is present and non-empty → replace defaults
 * - If patterns is present and empty ([]) → disable the category
 * - If key is absent from config → use defaults
 */
export interface PatternCategoryConfig {
  enabled?: boolean;
  patterns?: PatternEntry[];
}

/**
 * Single-pattern category (for structural patterns like option parsing)
 * - enabled: false → disable
 * - If pattern is absent → use default
 * - If pattern is "" (empty string) → disable
 */
export interface SinglePatternConfig {
  enabled?: boolean;
  pattern?: string;
  flags?: string;
}

/**
 * Tip filter configuration (uses substring matching, not regex)
 * - enabled: false → disable filtering
 * - If keywords is absent → use defaults
 * - If keywords is [] → disable filtering
 */
export interface TipFilterConfig {
  enabled?: boolean;
  keywords?: string[];
}

/**
 * Prompt separator configuration
 * - enabled: false → disable
 * - If pattern is absent → use default
 * - If pattern is "" → disable
 */
export interface PromptSeparatorConfig {
  enabled?: boolean;
  pattern?: string;
  minLength?: number;
}

/**
 * Customizable state detection patterns
 */
export interface PatternsConfig {
  selectionPrompt?: PatternCategoryConfig;
  interrupted?: PatternCategoryConfig;
  taskFailure?: PatternCategoryConfig;
  textInputKeywords?: PatternCategoryConfig;
  optionParse?: SinglePatternConfig;
  tipFilter?: TipFilterConfig;
  promptSeparator?: PromptSeparatorConfig;
}

/**
 * User-configurable settings loaded from .qlaude/config.json
 */
export interface QlaudeConfig {
  /**
   * Start with auto-execution paused
   * @default true
   */
  startPaused?: boolean;

  /**
   * Milliseconds of no PTY output before considering Claude Code ready
   * @default 1000
   */
  idleThresholdMs?: number;

  /**
   * Number of consecutive stable screen checks required before transitioning to READY
   * Higher values = more conservative, less chance of false READY detection
   * @default 3
   */
  requiredStableChecks?: number;

  /**
   * Log level for debugging
   * @default 'error' (or 'debug' if logFile is set)
   */
  logLevel?: LogLevel;

  /**
   * Log file path for debug output
   * If set, logs will be written to this file
   */
  logFile?: string;

  /**
   * Conversation logging configuration
   */
  conversationLog?: Partial<ConversationLogConfig>;

  /**
   * Telegram notification configuration
   */
  telegram?: Partial<TelegramConfig>;

  /**
   * Custom state detection patterns
   * Overrides default patterns when specified
   */
  patterns?: PatternsConfig;
}

/**
 * Default conversation log configuration
 */
export const DEFAULT_CONVERSATION_LOG_CONFIG: ConversationLogConfig = {
  enabled: false,
  filePath: 'conversation.log',
  timestamps: true,
};

/**
 * Default telegram configuration
 */
export const DEFAULT_TELEGRAM_CONFIG: TelegramConfig = {
  enabled: false,
  botToken: '',
  chatId: '',
  confirmDelayMs: 30000,
};

/**
 * Default configuration values
 */
export const DEFAULT_CONFIG: Required<Omit<QlaudeConfig, 'conversationLog' | 'telegram' | 'logLevel' | 'logFile' | 'patterns'>> & {
  conversationLog: ConversationLogConfig;
  telegram: TelegramConfig;
} = {
  startPaused: true,
  idleThresholdMs: 1000,
  requiredStableChecks: 3,
  conversationLog: DEFAULT_CONVERSATION_LOG_CONFIG,
  telegram: DEFAULT_TELEGRAM_CONFIG,
};
