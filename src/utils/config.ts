/**
 * Configuration loader for qlaude
 * Loads settings from .qlaude/ directory (config.json, patterns.json, telegram.json)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from './logger.js';
import { messages as defaultMessages, type Language } from './telegram-messages.js';
import type { QlaudeConfig, ConversationLogConfig, TelegramConfig, PatternsConfig, PatternCategoryConfig, PatternEntry } from '../types/config.js';
import { DEFAULT_CONFIG, DEFAULT_CONVERSATION_LOG_CONFIG, DEFAULT_TELEGRAM_CONFIG } from '../types/config.js';

/** Directory name for qlaude config and data files */
export const QLAUDE_DIR = '.qlaude';
const CONFIG_FILE = 'config.json';
const PATTERNS_FILE = 'patterns.json';
const TELEGRAM_FILE = 'telegram.json';
const MESSAGES_DIR = 'messages';
const LEGACY_CONFIG_FILENAME = '.qlauderc.json';

/**
 * Generate common config template (config.json)
 */
function generateCommonTemplate(): string {
  const template = {
    startPaused: DEFAULT_CONFIG.startPaused,
    idleThresholdMs: DEFAULT_CONFIG.idleThresholdMs,
    requiredStableChecks: DEFAULT_CONFIG.requiredStableChecks,
    logLevel: 'error',
    logFile: 'debug.log',
    conversationLog: {
      enabled: DEFAULT_CONVERSATION_LOG_CONFIG.enabled,
      filePath: DEFAULT_CONVERSATION_LOG_CONFIG.filePath,
      timestamps: DEFAULT_CONVERSATION_LOG_CONFIG.timestamps,
    },
  };
  return JSON.stringify(template, null, 2) + '\n';
}

/**
 * Generate patterns config template (patterns.json)
 */
function generatePatternsTemplate(): string {
  // Empty object — all built-in defaults are used when no overrides are specified.
  // Only add entries here when you want to override a specific category.
  return '{}\n';
}

/**
 * Migrate old patterns.json that contains the removed "spinner" config.
 * Backs up the old file as patterns.json.bak and creates a new empty one.
 */
function migratePatternsFile(qlaudeDir: string): void {
  const filePath = join(qlaudeDir, PATTERNS_FILE);
  if (!existsSync(filePath)) return;

  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'spinner' in parsed) {
      const bakPath = filePath + '.bak';
      renameSync(filePath, bakPath);
      writeFileSync(filePath, '{}\n', { encoding: 'utf-8', mode: 0o600 });
      logger.info({ bakPath }, 'Migrated old patterns.json (backed up as .bak)');
    }
  } catch {
    // Ignore parse/IO errors — loadJsonFile will handle them later
  }
}

/**
 * Detect language from system locale (e.g., ko-KR → ko, en-US → en)
 */
export function detectLanguage(): Language {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.startsWith('ko') ? 'ko' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Generate telegram config template (telegram.json)
 * Per-project settings only — credentials come from ~/.qlaude/telegram.json
 */
function generateTelegramTemplate(): string {
  const language = detectLanguage();
  const template = {
    enabled: false,
    language,
  };
  return JSON.stringify(template, null, 2) + '\n';
}

/**
 * Create message files for all supported languages in .qlaude/messages/
 */
function ensureMessageFiles(qlaudeDir: string): void {
  const messagesDir = join(qlaudeDir, MESSAGES_DIR);
  if (!existsSync(messagesDir)) {
    mkdirSync(messagesDir, { recursive: true });
  }
  for (const lang of ['ko', 'en'] as Language[]) {
    const filePath = join(messagesDir, `${lang}.json`);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, JSON.stringify(defaultMessages[lang], null, 2) + '\n', { encoding: 'utf-8', mode: 0o600 });
      logger.info({ path: filePath }, `Created message file: ${lang}.json`);
    }
  }
}

/**
 * Resolve the .qlaude directory path (CWD only).
 */
function resolveQlaudeDir(): string | null {
  const cwdDir = join(process.cwd(), QLAUDE_DIR);
  return existsSync(cwdDir) ? cwdDir : null;
}

/**
 * Warn if legacy .qlauderc.json exists
 */
function warnLegacyConfig(): void {
  const cwdLegacy = join(process.cwd(), LEGACY_CONFIG_FILENAME);
  if (existsSync(cwdLegacy)) {
    console.warn(`qlaude: Legacy config file found: ${cwdLegacy}`);
    console.warn(`qlaude: Please migrate to .qlaude/ directory structure.`);
    console.warn(`qlaude: Config files are now split into .qlaude/config.json, .qlaude/patterns.json, .qlaude/telegram.json`);
  }
}

/**
 * Check if this is the first run (no .qlaude/ directory in CWD).
 */
export function isFirstRun(): boolean {
  return !existsSync(join(process.cwd(), QLAUDE_DIR));
}

/**
 * Create .qlaude directory with config templates if they don't exist.
 * If the directory exists but config files are missing, creates the missing files.
 * Returns true if any files were created.
 */
export function ensureConfigDir(): boolean {
  const cwdDir = join(process.cwd(), QLAUDE_DIR);

  try {
    if (!existsSync(cwdDir)) {
      mkdirSync(cwdDir, { recursive: true });
    }

    const files: Array<{ name: string; generate: () => string }> = [
      { name: CONFIG_FILE, generate: generateCommonTemplate },
      { name: PATTERNS_FILE, generate: generatePatternsTemplate },
      { name: TELEGRAM_FILE, generate: generateTelegramTemplate },
    ];

    let created = false;
    for (const file of files) {
      const filePath = join(cwdDir, file.name);
      if (!existsSync(filePath)) {
        // Use restrictive permissions (owner-only) for config files that may contain secrets
        writeFileSync(filePath, file.generate(), { encoding: 'utf-8', mode: 0o600 });
        logger.info({ path: filePath }, `Created config file: ${file.name}`);
        created = true;
      }
    }

    // Create message files for all supported languages
    ensureMessageFiles(cwdDir);

    if (created) {
      logger.info({ path: cwdDir }, 'Config files created in .qlaude directory');
    }
    return created;
  } catch {
    // Silently ignore - may not have write permission
    return false;
  }
}

/**
 * Load global Telegram credentials from ~/.qlaude/telegram.json.
 * Returns validated partial config (botToken, chatId) or null.
 */
function loadGlobalTelegramConfig(): Partial<TelegramConfig> | null {
  const globalPath = join(homedir(), QLAUDE_DIR, TELEGRAM_FILE);
  const raw = loadJsonFile(globalPath);
  if (!raw) return null;
  logger.info({ path: globalPath }, 'Loading global Telegram credentials');
  return validateTelegramConfig(raw);
}

/**
 * Load configuration from .qlaude/ directory (CWD only).
 * Telegram credentials are loaded from ~/.qlaude/telegram.json (global),
 * then overlaid with per-project .qlaude/telegram.json settings.
 * Each file is loaded independently; missing files use defaults.
 */
export function loadConfig(): typeof DEFAULT_CONFIG & Pick<QlaudeConfig, 'patterns' | 'logLevel' | 'logFile'> {
  // Warn about legacy config
  warnLegacyConfig();

  // Load global Telegram credentials (always, even without project .qlaude/)
  const globalTelegram = loadGlobalTelegramConfig();

  const qlaudeDir = resolveQlaudeDir();

  if (!qlaudeDir) {
    logger.debug('No .qlaude directory found, using defaults');
    return mergeAllWithDefaults(null, null, globalTelegram);
  }

  logger.info({ path: qlaudeDir }, 'Loading config from .qlaude directory');

  // Migrate old patterns.json that contains removed spinner config
  migratePatternsFile(qlaudeDir);

  // Load each file independently
  const commonRaw = loadJsonFile(join(qlaudeDir, CONFIG_FILE));
  const patternsRaw = loadJsonFile(join(qlaudeDir, PATTERNS_FILE));
  const telegramRaw = loadJsonFile(join(qlaudeDir, TELEGRAM_FILE));

  // Validate each
  const common = commonRaw ? validateCommonConfig(commonRaw) : null;
  const patterns = patternsRaw ? validatePatternsConfig(patternsRaw) : null;
  const projectTelegram = telegramRaw ? validateTelegramConfig(telegramRaw) : null;

  // Merge: global credentials → project overrides
  const telegram: Partial<TelegramConfig> = {
    ...globalTelegram,
    ...projectTelegram,
  };

  // Load language-specific message file (messages/{language}.json)
  const lang = telegram.language ?? DEFAULT_TELEGRAM_CONFIG.language;
  const msgFileRaw = loadJsonFile(join(qlaudeDir, MESSAGES_DIR, `${lang}.json`));
  if (msgFileRaw && typeof msgFileRaw === 'object' && msgFileRaw !== null) {
    const fileMessages: Record<string, string> = {};
    for (const [k, v] of Object.entries(msgFileRaw as Record<string, unknown>)) {
      if (typeof v === 'string') fileMessages[k] = v;
    }
    // Message file is the base; telegram.json messages override on top
    telegram.messages = { ...fileMessages, ...telegram.messages };
  }

  return mergeAllWithDefaults(common, patterns, telegram);
}

/**
 * Load and parse a JSON file, returning null on failure
 */
function loadJsonFile(filePath: string): unknown {
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logger.warn({ path: filePath, error }, 'Failed to load config file');
    return null;
  }
}

/**
 * Validate conversationLog config
 */
function validateConversationLogConfig(
  obj: unknown
): Partial<ConversationLogConfig> | null {
  if (typeof obj !== 'object' || obj === null) {
    return null;
  }

  const config: Partial<ConversationLogConfig> = {};
  const input = obj as Record<string, unknown>;

  if (typeof input.enabled === 'boolean') {
    config.enabled = input.enabled;
  } else if (input.enabled !== undefined) {
    logger.warn({ value: input.enabled }, 'Invalid conversationLog.enabled value, ignoring');
  }

  if (typeof input.filePath === 'string' && input.filePath.length > 0) {
    config.filePath = input.filePath;
  } else if (input.filePath !== undefined) {
    logger.warn({ value: input.filePath }, 'Invalid conversationLog.filePath value, ignoring');
  }

  if (typeof input.timestamps === 'boolean') {
    config.timestamps = input.timestamps;
  } else if (input.timestamps !== undefined) {
    logger.warn({ value: input.timestamps }, 'Invalid conversationLog.timestamps value, ignoring');
  }

  return config;
}

/**
 * Validate telegram config (telegram.json is the top-level TelegramConfig)
 */
function validateTelegramConfig(
  obj: unknown
): Partial<TelegramConfig> | null {
  if (typeof obj !== 'object' || obj === null) {
    return null;
  }

  const config: Partial<TelegramConfig> = {};
  const input = obj as Record<string, unknown>;

  if (typeof input.enabled === 'boolean') {
    config.enabled = input.enabled;
  } else if (input.enabled !== undefined) {
    logger.warn({ value: input.enabled }, 'Invalid telegram.enabled value, ignoring');
  }

  if (typeof input.botToken === 'string') {
    config.botToken = input.botToken;
  } else if (input.botToken !== undefined) {
    logger.warn({ value: input.botToken }, 'Invalid telegram.botToken value, ignoring');
  }

  if (typeof input.chatId === 'string') {
    config.chatId = input.chatId;
  } else if (input.chatId !== undefined) {
    logger.warn({ value: input.chatId }, 'Invalid telegram.chatId value, ignoring');
  }

  if (typeof input.language === 'string' && ['ko', 'en'].includes(input.language)) {
    config.language = input.language as 'ko' | 'en';
  } else if (input.language !== undefined) {
    logger.warn({ value: input.language }, 'Invalid telegram.language value, ignoring');
  }

  if (typeof input.confirmDelayMs === 'number' && input.confirmDelayMs >= 0) {
    config.confirmDelayMs = input.confirmDelayMs;
  } else if (input.confirmDelayMs !== undefined) {
    logger.warn({ value: input.confirmDelayMs }, 'Invalid telegram.confirmDelayMs value, ignoring');
  }

  // Validate messages: Record<string, string>
  if (input.messages !== undefined) {
    if (typeof input.messages === 'object' && input.messages !== null) {
      const msgs: Record<string, string> = {};
      for (const [k, v] of Object.entries(input.messages as Record<string, unknown>)) {
        if (typeof v === 'string') msgs[k] = v;
      }
      if (Object.keys(msgs).length > 0) config.messages = msgs;
    } else {
      logger.warn({ value: input.messages }, 'Invalid telegram.messages value, ignoring');
    }
  }

  // Validate templates: Record<string, string>
  if (input.templates !== undefined) {
    if (typeof input.templates === 'object' && input.templates !== null) {
      const tpls: Record<string, string> = {};
      for (const [k, v] of Object.entries(input.templates as Record<string, unknown>)) {
        if (typeof v === 'string') tpls[k] = v;
      }
      if (Object.keys(tpls).length > 0) config.templates = tpls;
    } else {
      logger.warn({ value: input.templates }, 'Invalid telegram.templates value, ignoring');
    }
  }

  return config;
}

/**
 * Validate common config (config.json — no patterns or telegram sections)
 */
function validateCommonConfig(obj: unknown): QlaudeConfig | null {
  if (typeof obj !== 'object' || obj === null) {
    return null;
  }

  const config: QlaudeConfig = {};
  const input = obj as Record<string, unknown>;

  // Validate startPaused
  if (typeof input.startPaused === 'boolean') {
    config.startPaused = input.startPaused;
  } else if (input.startPaused !== undefined) {
    logger.warn({ value: input.startPaused }, 'Invalid startPaused value, ignoring');
  }

  // Validate idleThresholdMs
  if (typeof input.idleThresholdMs === 'number' && input.idleThresholdMs > 0) {
    config.idleThresholdMs = input.idleThresholdMs;
  } else if (input.idleThresholdMs !== undefined) {
    logger.warn({ value: input.idleThresholdMs }, 'Invalid idleThresholdMs value, ignoring');
  }

  // Validate requiredStableChecks
  if (typeof input.requiredStableChecks === 'number' && input.requiredStableChecks > 0) {
    config.requiredStableChecks = input.requiredStableChecks;
  } else if (input.requiredStableChecks !== undefined) {
    logger.warn({ value: input.requiredStableChecks }, 'Invalid requiredStableChecks value, ignoring');
  }

  // Validate logLevel
  const validLogLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
  if (typeof input.logLevel === 'string' && validLogLevels.includes(input.logLevel)) {
    config.logLevel = input.logLevel as QlaudeConfig['logLevel'];
  } else if (input.logLevel !== undefined) {
    logger.warn({ value: input.logLevel }, 'Invalid logLevel value, ignoring');
  }

  // Validate logFile
  if (typeof input.logFile === 'string' && input.logFile.length > 0) {
    config.logFile = input.logFile;
  } else if (input.logFile !== undefined) {
    logger.warn({ value: input.logFile }, 'Invalid logFile value, ignoring');
  }

  // Validate conversationLog
  if (input.conversationLog !== undefined) {
    const convLogConfig = validateConversationLogConfig(input.conversationLog);
    if (convLogConfig) {
      config.conversationLog = convLogConfig;
    }
  }

  return config;
}

/**
 * Validate a single pattern entry (string or { pattern, flags })
 */
function isValidPatternEntry(entry: unknown): entry is PatternEntry {
  if (typeof entry === 'string') return true;
  if (typeof entry === 'object' && entry !== null) {
    const obj = entry as Record<string, unknown>;
    return typeof obj.pattern === 'string' && (obj.flags === undefined || typeof obj.flags === 'string');
  }
  return false;
}

/**
 * Validate a pattern category config ({ enabled?, patterns? })
 * Empty array is valid and means "disable this category".
 */
function validatePatternCategory(obj: unknown): PatternCategoryConfig | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const input = obj as Record<string, unknown>;
  const result: PatternCategoryConfig = {};

  if (typeof input.enabled === 'boolean') {
    result.enabled = input.enabled;
  }
  if (Array.isArray(input.patterns)) {
    // Filter to valid entries; empty result = disabled
    result.patterns = input.patterns.filter(isValidPatternEntry);
  }
  return result;
}

/**
 * Validate patterns config (patterns.json — top-level is PatternsConfig directly).
 * Lightweight validation: checks structure, not regex validity.
 * Invalid regex will throw at compile time (acceptable per design).
 */
function validatePatternsConfig(obj: unknown): PatternsConfig | null {
  if (typeof obj !== 'object' || obj === null) {
    logger.warn({ value: obj }, 'Invalid patterns config, ignoring');
    return null;
  }

  const input = obj as Record<string, unknown>;
  const config: PatternsConfig = {};

  // Warn about removed spinner customization
  if (input.spinner !== undefined) {
    logger.warn('patterns.json contains "spinner" config which is no longer customizable — it will be ignored');
  }

  // Multi-pattern categories
  const categories = ['selectionPrompt', 'interrupted', 'taskFailure', 'textInputKeywords'] as const;
  for (const key of categories) {
    if (input[key] !== undefined) {
      const validated = validatePatternCategory(input[key]);
      if (validated) {
        config[key] = validated;
      }
    }
  }

  // Single-pattern: optionParse
  if (input.optionParse !== undefined && typeof input.optionParse === 'object' && input.optionParse !== null) {
    const op = input.optionParse as Record<string, unknown>;
    config.optionParse = {};
    if (typeof op.enabled === 'boolean') config.optionParse.enabled = op.enabled;
    if (typeof op.pattern === 'string') config.optionParse.pattern = op.pattern;
    if (typeof op.flags === 'string') config.optionParse.flags = op.flags;
  }

  // tipFilter
  if (input.tipFilter !== undefined && typeof input.tipFilter === 'object' && input.tipFilter !== null) {
    const tf = input.tipFilter as Record<string, unknown>;
    config.tipFilter = {};
    if (typeof tf.enabled === 'boolean') config.tipFilter.enabled = tf.enabled;
    if (Array.isArray(tf.keywords) && tf.keywords.every((k: unknown) => typeof k === 'string')) {
      config.tipFilter.keywords = tf.keywords as string[];
    }
  }

  // promptSeparator
  if (input.promptSeparator !== undefined && typeof input.promptSeparator === 'object' && input.promptSeparator !== null) {
    const ps = input.promptSeparator as Record<string, unknown>;
    config.promptSeparator = {};
    if (typeof ps.enabled === 'boolean') config.promptSeparator.enabled = ps.enabled;
    if (typeof ps.pattern === 'string') config.promptSeparator.pattern = ps.pattern;
    if (typeof ps.minLength === 'number' && ps.minLength > 0) config.promptSeparator.minLength = ps.minLength;
  }

  return config;
}

/**
 * Merge all config sources with defaults
 */
function mergeAllWithDefaults(
  common: QlaudeConfig | null,
  patterns: PatternsConfig | null,
  telegram: Partial<TelegramConfig> | null,
): typeof DEFAULT_CONFIG & Pick<QlaudeConfig, 'patterns' | 'logLevel' | 'logFile'> {
  return {
    ...DEFAULT_CONFIG,
    ...common,
    conversationLog: {
      ...DEFAULT_CONVERSATION_LOG_CONFIG,
      ...common?.conversationLog,
    },
    telegram: {
      ...DEFAULT_TELEGRAM_CONFIG,
      ...telegram,
    },
    patterns: patterns ?? undefined,
  };
}
