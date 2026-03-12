import { ipcMain, app, dialog, BrowserWindow, shell } from "electron";
import path, { join, dirname as dirname$1, resolve, basename } from "path";
import os, { homedir, tmpdir, hostname, platform } from "os";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync as existsSync$1, writeFileSync, readFileSync, renameSync, unlinkSync, appendFileSync, readdirSync } from "fs";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import * as pty from "node-pty";
import pino from "pino";
import { createRequire } from "node:module";
import { existsSync, accessSync, constants, chmodSync } from "node:fs";
import { dirname, join as join$1 } from "node:path";
import { EventEmitter as EventEmitter$1 } from "node:events";
import * as fs from "node:fs/promises";
import pkg from "@xterm/headless";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const SCHEMA_VERSION = 1;
const CREATE_TASKS = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  workspace_path TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK(status IN ('queued','running','completed','failed','paused')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  failed_reason TEXT,
  is_new_session INTEGER NOT NULL DEFAULT 0,
  model_name TEXT,
  delay_ms INTEGER,
  is_breakpoint INTEGER NOT NULL DEFAULT 0,
  label_session TEXT,
  load_session_label TEXT,
  execution_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
)`;
const CREATE_SETTINGS = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;
const CREATE_TELEGRAM_CONFIG = `
CREATE TABLE IF NOT EXISTS telegram_config (
  id INTEGER PRIMARY KEY DEFAULT 1,
  bot_token TEXT,
  chat_id TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  validated INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
)`;
const CREATE_SCHEMA_VERSION = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
)`;
function initDatabase(dbPath2) {
  const dir = join(dbPath2, "..");
  mkdirSync(dir, { recursive: true });
  const db2 = new DatabaseSync(dbPath2);
  db2.exec("PRAGMA journal_mode = WAL");
  db2.exec("PRAGMA foreign_keys = ON");
  db2.exec(CREATE_SCHEMA_VERSION);
  db2.exec(CREATE_TASKS);
  db2.exec(CREATE_SETTINGS);
  db2.exec(CREATE_TELEGRAM_CONFIG);
  const versionRow = db2.prepare("SELECT version FROM schema_version").get();
  if (!versionRow) {
    db2.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
  }
  return db2;
}
class TaskRepository {
  constructor(db2) {
    this.db = db2;
  }
  create(input) {
    const id = randomUUID();
    const maxOrder = this.db.prepare("SELECT MAX(sort_order) as max FROM tasks WHERE workspace_path = ?").get(input.workspace_path);
    const sortOrder = (maxOrder.max ?? -1) + 1;
    this.db.prepare(`
      INSERT INTO tasks (
        id, workspace_path, title, prompt, status,
        is_new_session, model_name, delay_ms, is_breakpoint,
        label_session, load_session_label, sort_order
      ) VALUES (
        @id, @workspace_path, @title, @prompt, @status,
        @is_new_session, @model_name, @delay_ms, @is_breakpoint,
        @label_session, @load_session_label, @sort_order
      )
    `).run({
      "@id": id,
      "@workspace_path": input.workspace_path,
      "@title": input.title ?? "",
      "@prompt": input.prompt,
      "@status": input.status ?? "queued",
      "@is_new_session": input.is_new_session ?? 0,
      "@model_name": input.model_name ?? null,
      "@delay_ms": input.delay_ms ?? null,
      "@is_breakpoint": input.is_breakpoint ?? 0,
      "@label_session": input.label_session ?? null,
      "@load_session_label": input.load_session_label ?? null,
      "@sort_order": sortOrder
    });
    return this.getById(id);
  }
  getById(id) {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
  }
  listByWorkspace(workspacePath2, statusFilter) {
    if (statusFilter && statusFilter.length > 0) {
      const placeholders = statusFilter.map(() => "?").join(",");
      return this.db.prepare(`SELECT * FROM tasks WHERE workspace_path = ? AND status IN (${placeholders}) ORDER BY sort_order ASC, created_at ASC`).all(workspacePath2, ...statusFilter);
    }
    return this.db.prepare("SELECT * FROM tasks WHERE workspace_path = ? ORDER BY sort_order ASC, created_at ASC").all(workspacePath2);
  }
  listQueued(workspacePath2) {
    return this.listByWorkspace(workspacePath2, ["queued", "paused"]);
  }
  update(id, fields) {
    const allowed = [
      "title",
      "prompt",
      "status",
      "started_at",
      "completed_at",
      "failed_reason",
      "is_new_session",
      "model_name",
      "delay_ms",
      "is_breakpoint",
      "label_session",
      "load_session_label",
      "execution_id",
      "sort_order"
    ];
    const updates = Object.entries(fields).filter(([k]) => allowed.includes(k)).map(([k]) => `${k} = @${k}`).join(", ");
    if (!updates) return this.getById(id);
    const prefixedFields = Object.fromEntries(
      Object.entries(fields).filter(([k]) => allowed.includes(k)).map(([k, v]) => [`@${k}`, v])
    );
    this.db.prepare(`UPDATE tasks SET ${updates}, updated_at = datetime('now') WHERE id = @id`).run({ ...prefixedFields, "@id": id });
    return this.getById(id);
  }
  delete(id) {
    const result = this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return result.changes > 0;
  }
  reorder(id, newOrder) {
    const task = this.getById(id);
    if (!task) return;
    const oldOrder = task.sort_order;
    if (oldOrder === newOrder) return;
    try {
      this.db.exec("BEGIN");
      if (newOrder > oldOrder) {
        this.db.prepare(
          "UPDATE tasks SET sort_order = sort_order - 1 WHERE workspace_path = ? AND sort_order > ? AND sort_order <= ?"
        ).run(task.workspace_path, oldOrder, newOrder);
      } else {
        this.db.prepare(
          "UPDATE tasks SET sort_order = sort_order + 1 WHERE workspace_path = ? AND sort_order >= ? AND sort_order < ?"
        ).run(task.workspace_path, newOrder, oldOrder);
      }
      this.db.prepare("UPDATE tasks SET sort_order = ? WHERE id = ?").run(newOrder, id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  markRunning(id) {
    return this.update(id, {
      status: "running",
      started_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  markCompleted(id) {
    return this.update(id, {
      status: "completed",
      completed_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
  markFailed(id, reason) {
    return this.update(id, {
      status: "failed",
      failed_reason: reason,
      completed_at: (/* @__PURE__ */ new Date()).toISOString()
    });
  }
}
class SettingsRepository {
  constructor(db2) {
    this.db = db2;
  }
  get(key) {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row?.value ?? null;
  }
  getJson(key) {
    const raw = this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  set(key, value) {
    this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
    `).run(key, value);
  }
  setJson(key, value) {
    this.set(key, JSON.stringify(value));
  }
  delete(key) {
    this.db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }
}
class TelegramRepository {
  constructor(db2) {
    this.db = db2;
  }
  ensureRow() {
    const row = this.db.prepare("SELECT id FROM telegram_config WHERE id = 1").get();
    if (!row) {
      this.db.prepare("INSERT INTO telegram_config (id) VALUES (1)").run();
    }
  }
  get() {
    this.ensureRow();
    const row = this.db.prepare("SELECT * FROM telegram_config WHERE id = 1").get();
    return {
      bot_token: row.bot_token,
      chat_id: row.chat_id,
      enabled: row.enabled === 1,
      validated: row.validated === 1
    };
  }
  update(fields) {
    this.ensureRow();
    const updates = [];
    const params = {};
    if (fields.bot_token !== void 0) {
      updates.push("bot_token = @bot_token");
      params["@bot_token"] = fields.bot_token;
    }
    if (fields.chat_id !== void 0) {
      updates.push("chat_id = @chat_id");
      params["@chat_id"] = fields.chat_id;
    }
    if (fields.enabled !== void 0) {
      updates.push("enabled = @enabled");
      params["@enabled"] = fields.enabled ? 1 : 0;
    }
    if (fields.validated !== void 0) {
      updates.push("validated = @validated");
      params["@validated"] = fields.validated ? 1 : 0;
    }
    if (updates.length === 0) return;
    this.db.prepare(
      `UPDATE telegram_config SET ${updates.join(", ")}, updated_at = datetime('now') WHERE id = 1`
    ).run(params);
  }
  isConfigured() {
    const config = this.get();
    return !!(config.bot_token && config.chat_id && config.validated);
  }
}
let currentLogger = createLogger();
function createLogger(logFile, logLevel) {
  return pino({
    level: process.env.LOG_LEVEL || "error",
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true
      }
    }
  });
}
const logger = new Proxy({}, {
  get(_target, prop) {
    return currentLogger[prop];
  }
});
function buildPtySpawnArgs(claudeArgs) {
  return { shell: "claude", args: claudeArgs };
}
var ErrorCode = /* @__PURE__ */ ((ErrorCode2) => {
  ErrorCode2["PTY_SPAWN_FAILED"] = "E101";
  ErrorCode2["PTY_WRITE_FAILED"] = "E102";
  ErrorCode2["PTY_UNEXPECTED_EXIT"] = "E103";
  ErrorCode2["PTY_SPAWN_HELPER_FAILED"] = "E104";
  ErrorCode2["QUEUE_FILE_READ_FAILED"] = "E201";
  ErrorCode2["QUEUE_FILE_WRITE_FAILED"] = "E202";
  ErrorCode2["QUEUE_PARSE_FAILED"] = "E203";
  ErrorCode2["STATE_DETECTION_TIMEOUT"] = "E301";
  ErrorCode2["STATE_PATTERN_MISMATCH"] = "E302";
  return ErrorCode2;
})(ErrorCode || {});
const userFriendlyMessages = {
  [
    "E101"
    /* PTY_SPAWN_FAILED */
  ]: "Failed to start Claude Code. Please check if it is installed.",
  [
    "E102"
    /* PTY_WRITE_FAILED */
  ]: "Failed to send input to Claude Code.",
  [
    "E103"
    /* PTY_UNEXPECTED_EXIT */
  ]: "Claude Code exited unexpectedly. Shutting down safely.",
  [
    "E104"
    /* PTY_SPAWN_HELPER_FAILED */
  ]: "Failed to start Claude Code because node-pty spawn-helper is missing or not executable. Reinstall dependencies or fix its execute permission.",
  [
    "E201"
    /* QUEUE_FILE_READ_FAILED */
  ]: "Queue file not found. Using empty queue.",
  [
    "E202"
    /* QUEUE_FILE_WRITE_FAILED */
  ]: "Cannot save queue. Changes may be lost on exit.",
  [
    "E203"
    /* QUEUE_PARSE_FAILED */
  ]: "Queue file corrupted. Using empty queue.",
  [
    "E301"
    /* STATE_DETECTION_TIMEOUT */
  ]: "State detection timed out. Safe mode enabled.",
  [
    "E302"
    /* STATE_PATTERN_MISMATCH */
  ]: "Unknown state detected. Safe mode enabled."
};
function getUserFriendlyMessage(code) {
  return userFriendlyMessages[code];
}
class QlaudeError extends Error {
  constructor(message, code, recoverable = true, cause) {
    super(message);
    this.code = code;
    this.recoverable = recoverable;
    this.cause = cause;
    this.name = "QlaudeError";
  }
}
class PtyError extends QlaudeError {
  constructor(message, code, recoverable = true, cause) {
    super(message, code, recoverable, cause);
    this.name = "PtyError";
  }
  /**
   * Get user-friendly message for this error
   */
  getUserFriendlyMessage() {
    return getUserFriendlyMessage(this.code);
  }
}
function ensureSpawnHelper() {
  const require3 = createRequire(import.meta.url);
  let nodePtyMain;
  try {
    nodePtyMain = require3.resolve("node-pty");
  } catch (err) {
    throw new Error(`Cannot resolve node-pty: ${err.message}`);
  }
  const nodePtyDir = dirname(nodePtyMain);
  const archs = ["darwin-arm64", "darwin-x64"];
  for (const arch of archs) {
    const helperPath = join$1(nodePtyDir, "..", "prebuilds", arch, "spawn-helper");
    if (!existsSync(helperPath)) {
      continue;
    }
    try {
      accessSync(helperPath, constants.X_OK);
      return;
    } catch {
      try {
        chmodSync(helperPath, 493);
        return;
      } catch (chmodErr) {
        throw new Error(
          `spawn-helper at ${helperPath} is not executable and chmod failed: ${chmodErr.message}`
        );
      }
    }
  }
  const expectedPath = join$1(nodePtyDir, "..", "prebuilds", "darwin-arm64", "spawn-helper");
  throw new Error(`node-pty spawn-helper not found. Expected: ${expectedPath}`);
}
class PtyWrapper extends EventEmitter {
  pty = null;
  isRestarting = false;
  emit(event, ...args) {
    return super.emit(event, ...args);
  }
  on(event, listener) {
    return super.on(event, listener);
  }
  spawn(claudeArgs) {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 30;
    const { shell: shell2, args } = buildPtySpawnArgs(claudeArgs);
    try {
      ensureSpawnHelper();
    } catch (error) {
      throw new PtyError(
        `node-pty spawn-helper not executable: ${error.message}`,
        ErrorCode.PTY_SPAWN_HELPER_FAILED,
        false,
        error
      );
    }
    try {
      const termName = !process.env.TERM || process.env.TERM === "dumb" ? "xterm-256color" : process.env.TERM;
      logger.debug({ termName, cols, rows }, "Spawning PTY with terminal type");
      this.pty = pty.spawn(shell2, args, {
        name: termName,
        cols,
        rows,
        cwd: process.cwd(),
        env: process.env
      });
      this.pty.onData((data) => {
        this.emit("data", data);
      });
      this.pty.onExit(({ exitCode, signal }) => {
        this.pty = null;
        if (this.isRestarting) {
          logger.debug("PTY exit during restart, not propagating");
          return;
        }
        if (exitCode !== 0) {
          const error = new PtyError(
            `PTY exited with code ${exitCode}${signal ? ` (signal: ${signal})` : ""}`,
            ErrorCode.PTY_UNEXPECTED_EXIT,
            false
          );
          logger.error({ error, exitCode, signal }, "PTY unexpected exit");
        }
        this.emit("exit", exitCode, signal);
      });
      logger.debug({ cols, rows, shell: shell2, args }, "PTY spawned");
    } catch (error) {
      logger.error({ error }, "PTY spawn failed");
      throw error;
    }
  }
  write(data) {
    if (this.pty) {
      this.pty.write(data);
    }
  }
  resize(cols, rows) {
    if (this.pty) {
      this.pty.resize(cols, rows);
      logger.debug({ cols, rows }, "Terminal resized");
    }
  }
  kill() {
    if (this.pty) {
      this.pty.kill();
      this.pty = null;
    }
  }
  isRunning() {
    return this.pty !== null;
  }
  /**
   * Gracefully restart PTY session
   * Kills existing PTY, waits for exit, then spawns new PTY
   *
   * @param claudeArgs - CLI arguments for new PTY session
   * @throws Error if spawn fails after restart
   */
  async restart(claudeArgs) {
    if (!this.isRunning()) {
      this.spawn(claudeArgs);
      return;
    }
    this.isRestarting = true;
    return new Promise((resolve2, reject) => {
      const currentPty = this.pty;
      currentPty.onExit(() => {
        this.pty = null;
        this.isRestarting = false;
        try {
          this.spawn(claudeArgs);
          resolve2();
        } catch (error) {
          reject(error);
        }
      });
      currentPty.kill();
    });
  }
}
const DEFAULT_CONVERSATION_LOG_CONFIG = {
  enabled: false,
  filePath: "conversation.log",
  timestamps: true
};
const DEFAULT_TELEGRAM_CONFIG = {
  enabled: false,
  botToken: "",
  chatId: "",
  confirmDelayMs: 3e4
};
const DEFAULT_CONFIG = {
  startPaused: true,
  idleThresholdMs: 1e3,
  requiredStableChecks: 3,
  conversationLog: DEFAULT_CONVERSATION_LOG_CONFIG,
  telegram: DEFAULT_TELEGRAM_CONFIG
};
const DEFAULT_SELECTION_PROMPT_PATTERNS = [
  /\[Y\/n\]/i,
  /\[y\/N\]/i,
  /❯\s*\d+\.\s/,
  // Arrow cursor with numbered option
  /Enter to select · ↑\/↓ to navigate/,
  // Claude Code selection UI footer
  /←\/→ or tab to cycle/,
  /^\s*>\s*\d+\.\s+\w+/m
];
const DEFAULT_INTERRUPTED_PATTERNS = [
  /^Interrupted$/im,
  /\^C/,
  /operation cancelled/i,
  /request aborted/i,
  /was interrupted/i
];
const SPINNER_PATTERN = /^\s*[*·✢✳∗✻✽✶].*…(?:\s*\(.*\))?\s*$/;
const DEFAULT_TASK_FAILURE_PATTERNS = [
  /QUEUE_STOP(?::\s*(.+?))?(?:\n|$)/i,
  // QUEUE_STOP or QUEUE_STOP: reason
  /\[QUEUE_STOP\](?:\s*(.+?))?(?:\n|$)/,
  // [QUEUE_STOP] or [QUEUE_STOP] reason
  /You['\u2019]ve hit your limit/i
  // Rate limit message (exact Claude Code message)
];
const DEFAULT_TEXT_INPUT_KEYWORDS = [
  /\btype\b/i,
  /\benter\b/i,
  /\binput\b/i,
  /\bcustom\b/i,
  /\bspecify\b/i,
  /\bother\b/i,
  /\.{2,}$/
  // Ends with "..." or ".."
];
const DEFAULT_OPTION_PARSE_PATTERN = /^[\s❯>]*(\d+)\.\s+(.+)$/;
const DEFAULT_TIP_FILTER_KEYWORDS = ["⎿", "Tip:"];
const DEFAULT_PROMPT_SEPARATOR_PATTERN = /^─+$/;
const DEFAULT_PROMPT_SEPARATOR_MIN_LENGTH = 10;
function compileEntry(entry) {
  if (typeof entry === "string") {
    return new RegExp(entry);
  }
  return new RegExp(entry.pattern, entry.flags ?? "");
}
function compileCategory(config, defaults) {
  if (!config) {
    return { patterns: defaults };
  }
  if (config.enabled === false) {
    return { patterns: [] };
  }
  if (config.patterns === void 0) {
    return { patterns: defaults };
  }
  if (config.patterns.length === 0) {
    return { patterns: [] };
  }
  const patterns = config.patterns.map(compileEntry);
  return { patterns };
}
function compilePatterns(config) {
  const defaults = {
    selectionPrompt: { patterns: DEFAULT_SELECTION_PROMPT_PATTERNS },
    interrupted: { patterns: DEFAULT_INTERRUPTED_PATTERNS },
    taskFailure: { patterns: DEFAULT_TASK_FAILURE_PATTERNS },
    textInputKeywords: { patterns: DEFAULT_TEXT_INPUT_KEYWORDS },
    optionParse: { pattern: DEFAULT_OPTION_PARSE_PATTERN },
    tipFilter: { keywords: DEFAULT_TIP_FILTER_KEYWORDS },
    promptSeparator: {
      pattern: DEFAULT_PROMPT_SEPARATOR_PATTERN,
      minLength: DEFAULT_PROMPT_SEPARATOR_MIN_LENGTH
    }
  };
  if (!config) {
    return defaults;
  }
  logger.info("Compiling custom patterns from config");
  let optionParsePattern = DEFAULT_OPTION_PARSE_PATTERN;
  if (config.optionParse) {
    if (config.optionParse.enabled === false || config.optionParse.pattern === "") {
      optionParsePattern = null;
    } else if (config.optionParse.pattern) {
      optionParsePattern = new RegExp(config.optionParse.pattern, config.optionParse.flags ?? "");
    }
  }
  let promptSeparatorPattern = DEFAULT_PROMPT_SEPARATOR_PATTERN;
  if (config.promptSeparator) {
    if (config.promptSeparator.enabled === false || config.promptSeparator.pattern === "") {
      promptSeparatorPattern = null;
    } else if (config.promptSeparator.pattern) {
      promptSeparatorPattern = new RegExp(config.promptSeparator.pattern);
    }
  }
  let tipFilterKeywords = DEFAULT_TIP_FILTER_KEYWORDS;
  if (config.tipFilter) {
    if (config.tipFilter.enabled === false) {
      tipFilterKeywords = [];
    } else if (config.tipFilter.keywords) {
      tipFilterKeywords = config.tipFilter.keywords;
    }
  }
  return {
    selectionPrompt: compileCategory(config.selectionPrompt, DEFAULT_SELECTION_PROMPT_PATTERNS),
    interrupted: compileCategory(config.interrupted, DEFAULT_INTERRUPTED_PATTERNS),
    taskFailure: compileCategory(config.taskFailure, DEFAULT_TASK_FAILURE_PATTERNS),
    textInputKeywords: compileCategory(config.textInputKeywords, DEFAULT_TEXT_INPUT_KEYWORDS),
    optionParse: {
      pattern: optionParsePattern
    },
    tipFilter: {
      keywords: tipFilterKeywords
    },
    promptSeparator: {
      pattern: promptSeparatorPattern,
      minLength: config.promptSeparator?.minLength ?? DEFAULT_PROMPT_SEPARATOR_MIN_LENGTH
    }
  };
}
class StateDetector extends EventEmitter {
  idleThresholdMs;
  requiredStableChecks;
  patterns;
  screenContentProvider = null;
  currentState;
  idleTimer = null;
  lastOutputTime = 0;
  lastScreenSnapshot = "";
  consecutiveStableChecks = 0;
  lastFailureMarkerCount = 0;
  lastFailureReason;
  constructor(config = {}) {
    super();
    this.idleThresholdMs = config.idleThresholdMs ?? DEFAULT_CONFIG.idleThresholdMs;
    this.requiredStableChecks = config.requiredStableChecks ?? DEFAULT_CONFIG.requiredStableChecks;
    this.patterns = config.patterns ?? compilePatterns();
    this.screenContentProvider = config.screenContentProvider ?? null;
    this.currentState = {
      type: "PROCESSING",
      timestamp: Date.now()
    };
    logger.debug({ idleThresholdMs: this.idleThresholdMs }, "StateDetector initialized");
  }
  /**
   * Set the screen content provider for pattern analysis
   */
  setScreenContentProvider(provider) {
    this.screenContentProvider = provider;
  }
  /**
   * Analyze a chunk of PTY output
   * Any output means Claude is processing; idle triggers pattern analysis
   */
  analyze(chunk) {
    this.lastOutputTime = Date.now();
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.currentState.type !== "PROCESSING") {
      this.transitionTo("PROCESSING");
    }
    this.idleTimer = setTimeout(() => {
      this.handleIdleTimeout();
    }, this.idleThresholdMs);
  }
  /**
   * Handle idle timeout - analyze screen and determine state
   * Uses screen stability check to prevent false READY detection
   */
  handleIdleTimeout() {
    const idleMs = Date.now() - this.lastOutputTime;
    logger.debug({ idleMs }, "Idle timeout reached, analyzing screen");
    const screenContent = this.screenContentProvider?.() ?? [];
    const content = screenContent.join("\n");
    logger.debug({ screenContent, contentLength: content.length }, "Screen content for analysis");
    const detectedState = this.detectStateFromScreen(screenContent);
    if (detectedState === "READY") {
      if (content !== this.lastScreenSnapshot) {
        this.consecutiveStableChecks = 0;
        this.lastScreenSnapshot = content;
        logger.debug(
          {
            reason: "SCREEN_CHANGED",
            currentState: this.currentState.type,
            contentPreview: content.slice(-200)
          },
          "READY transition blocked: screen content changed, resetting stability counter"
        );
        this.idleTimer = setTimeout(() => {
          this.handleIdleTimeout();
        }, this.idleThresholdMs);
        return;
      }
      this.consecutiveStableChecks++;
      logger.debug(
        { consecutiveStableChecks: this.consecutiveStableChecks, required: this.requiredStableChecks },
        "Screen stable, checking stability count"
      );
      if (this.consecutiveStableChecks < this.requiredStableChecks) {
        logger.debug(
          {
            reason: "STABILITY_CHECK_PENDING",
            current: this.consecutiveStableChecks,
            required: this.requiredStableChecks,
            currentState: this.currentState.type
          },
          "READY transition blocked: waiting for more stability checks"
        );
        this.idleTimer = setTimeout(() => {
          this.handleIdleTimeout();
        }, this.idleThresholdMs);
        return;
      }
      if (this.hasSpinnerPattern(content)) {
        logger.debug(
          {
            reason: "SPINNER_DETECTED",
            stableChecks: this.consecutiveStableChecks,
            currentState: this.currentState.type
          },
          "READY transition blocked: spinner detected, continuing to wait"
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
        "Screen stable for required duration, transitioning to READY"
      );
    }
    this.consecutiveStableChecks = 0;
    this.lastScreenSnapshot = "";
    if (this.currentState.type !== detectedState) {
      logger.debug(
        { detectedState, screenLines: screenContent.length },
        "State detected from screen analysis"
      );
      const metadata = {
        bufferSnapshot: content
      };
      if (detectedState === "SELECTION_PROMPT") {
        metadata.options = this.parseOptionsFromScreen(screenContent);
        logger.debug({ options: metadata.options }, "Parsed options from screen");
      }
      if (detectedState === "READY") {
        metadata.hasSpinner = this.hasSpinnerPattern(content);
      }
      if (detectedState === "TASK_FAILED") {
        metadata.failureReason = this.lastFailureReason;
      }
      this.transitionTo(detectedState, metadata);
    }
  }
  /**
   * Check if option text indicates text input is required
   */
  isTextInputOption(text) {
    return this.patterns.textInputKeywords.patterns.some((pattern) => pattern.test(text));
  }
  /**
   * Parse numbered options from screen content
   * Matches patterns like "1. Option text" or "❯ 1. Option text"
   */
  parseOptionsFromScreen(lines) {
    if (!this.patterns.optionParse.pattern) return [];
    const options = [];
    const seenNumbers = /* @__PURE__ */ new Set();
    for (let i = lines.length - 1; i >= 0; i--) {
      const match = lines[i].match(this.patterns.optionParse.pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        const text = match[2].trim();
        if (!seenNumbers.has(num) && text.length > 0) {
          seenNumbers.add(num);
          options.push({
            number: num,
            text,
            isTextInput: this.isTextInputOption(text)
          });
        }
      }
    }
    options.sort((a, b) => a.number - b.number);
    return options;
  }
  /**
   * Filter out prompt input lines between horizontal separator lines.
   * Claude Code UI renders the input area as: ────\n❯ <user input>\n────
   * User input text can match blocking patterns (e.g., "approve"), causing false positives.
   */
  filterPromptInputLines(lines) {
    const sepPattern = this.patterns.promptSeparator.pattern;
    if (!sepPattern) return lines;
    const { minLength } = this.patterns.promptSeparator;
    const isSeparator = (line) => {
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
  detectStateFromScreen(lines) {
    if (this.patterns.taskFailure.patterns.length > 0) {
      const unfilteredContent = lines.join("\n");
      if (this.detectTaskFailure(unfilteredContent).failed) {
        return "TASK_FAILED";
      }
    }
    const filteredLines = this.patterns.tipFilter.keywords.length > 0 ? lines.filter((line) => !this.patterns.tipFilter.keywords.some((kw) => line.includes(kw))) : lines;
    const promptFiltered = this.filterPromptInputLines(filteredLines);
    const content = promptFiltered.join("\n");
    const interruptedMatch = this.findMatchingPattern(content, this.patterns.interrupted.patterns);
    if (interruptedMatch) {
      logger.debug(
        { pattern: interruptedMatch.pattern, matched: interruptedMatch.matched },
        "INTERRUPTED pattern detected"
      );
      return "INTERRUPTED";
    }
    const selectionMatch = this.findMatchingPattern(content, this.patterns.selectionPrompt.patterns);
    if (selectionMatch) {
      logger.debug(
        { pattern: selectionMatch.pattern, matched: selectionMatch.matched },
        "SELECTION_PROMPT pattern detected"
      );
      return "SELECTION_PROMPT";
    }
    return "READY";
  }
  /**
   * Find the first matching pattern and return details
   */
  findMatchingPattern(content, patterns) {
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
  detectTaskFailure(content) {
    const lines = content.split("\n");
    let currentCount = 0;
    let lastReason;
    for (const line of lines) {
      for (const pattern of this.patterns.taskFailure.patterns) {
        const match = line.match(pattern);
        if (match) {
          currentCount++;
          lastReason = match[1]?.trim() || lastReason;
          break;
        }
      }
    }
    const previousCount = this.lastFailureMarkerCount;
    this.lastFailureMarkerCount = currentCount;
    if (currentCount > previousCount) {
      logger.debug({ currentCount, previousCount, reason: lastReason }, "QUEUE_STOP marker count increased");
      this.lastFailureReason = lastReason;
      return { failed: true, reason: lastReason };
    }
    return { failed: false };
  }
  /**
   * Check if screen contains an active spinner line.
   * Checks each line individually so ^ and $ anchors work correctly.
   */
  hasSpinnerPattern(content) {
    for (const line of content.split("\n")) {
      const match = line.match(SPINNER_PATTERN);
      if (match) {
        logger.debug({ matchedText: match[0], matchedLine: line }, "Spinner pattern matched");
        return true;
      }
    }
    return false;
  }
  /**
   * Get current state
   */
  getState() {
    return { ...this.currentState };
  }
  /**
   * Check if Claude Code is ready for queue execution
   * Returns true only when in READY state
   */
  isReadyForQueue() {
    return this.currentState.type === "READY";
  }
  /**
   * Reset state to initial (PROCESSING)
   * Starts a fresh idle timer to ensure we can transition to READY
   */
  reset() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.lastOutputTime = Date.now();
    this.lastScreenSnapshot = "";
    this.consecutiveStableChecks = 0;
    this.lastFailureMarkerCount = 0;
    this.transitionTo("PROCESSING");
    this.idleTimer = setTimeout(() => {
      this.handleIdleTimeout();
    }, this.idleThresholdMs);
  }
  /**
   * Force immediate transition to READY state (no timer delay)
   * Use for :resume command where we know we want to execute immediately
   */
  forceReady() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.lastOutputTime = Date.now();
    this.lastScreenSnapshot = "";
    this.consecutiveStableChecks = 0;
    this.transitionTo("READY");
  }
  /**
   * Transition to a new state and emit event
   */
  transitionTo(newState, metadata) {
    const previousState = this.currentState.type;
    this.currentState = {
      type: newState,
      timestamp: Date.now(),
      metadata
    };
    logger.debug({ from: previousState, to: newState }, "State transition");
    this.emit("state_change", this.getState());
  }
  /**
   * Clean up timers
   */
  dispose() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
const NEW_SESSION_MESSAGES = {
  STARTING: "[Queue] Starting new session...",
  FAILED: "[Queue] Failed to start new session",
  FAILED_MAX_RETRIES: "[Queue] Failed to start new session (max retries exceeded)"
};
const QLAUDE_DIR = ".qlaude";
const CONFIG_FILE = "config.json";
const PATTERNS_FILE = "patterns.json";
const TELEGRAM_FILE = "telegram.json";
const LEGACY_CONFIG_FILENAME = ".qlauderc.json";
function generateCommonTemplate() {
  const template = {
    startPaused: DEFAULT_CONFIG.startPaused,
    idleThresholdMs: DEFAULT_CONFIG.idleThresholdMs,
    requiredStableChecks: DEFAULT_CONFIG.requiredStableChecks,
    logLevel: "error",
    logFile: "debug.log",
    conversationLog: {
      enabled: DEFAULT_CONVERSATION_LOG_CONFIG.enabled,
      filePath: DEFAULT_CONVERSATION_LOG_CONFIG.filePath,
      timestamps: DEFAULT_CONVERSATION_LOG_CONFIG.timestamps
    }
  };
  return JSON.stringify(template, null, 2) + "\n";
}
function generatePatternsTemplate() {
  return "{}\n";
}
function migratePatternsFile(qlaudeDir) {
  const filePath = join(qlaudeDir, PATTERNS_FILE);
  if (!existsSync$1(filePath)) return;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "spinner" in parsed) {
      const bakPath = filePath + ".bak";
      renameSync(filePath, bakPath);
      writeFileSync(filePath, "{}\n", { encoding: "utf-8", mode: 384 });
      logger.info({ bakPath }, "Migrated old patterns.json (backed up as .bak)");
    }
  } catch {
  }
}
function generateTelegramTemplate() {
  return JSON.stringify({ enabled: false }, null, 2) + "\n";
}
function resolveQlaudeDir() {
  const cwdDir = join(process.cwd(), QLAUDE_DIR);
  return existsSync$1(cwdDir) ? cwdDir : null;
}
function warnLegacyConfig() {
  const cwdLegacy = join(process.cwd(), LEGACY_CONFIG_FILENAME);
  if (existsSync$1(cwdLegacy)) {
    console.warn(`qlaude: Legacy config file found: ${cwdLegacy}`);
    console.warn(`qlaude: Please migrate to .qlaude/ directory structure.`);
    console.warn(`qlaude: Config files are now split into .qlaude/config.json, .qlaude/patterns.json, .qlaude/telegram.json`);
  }
}
function ensureConfigDir() {
  const cwdDir = join(process.cwd(), QLAUDE_DIR);
  try {
    if (!existsSync$1(cwdDir)) {
      mkdirSync(cwdDir, { recursive: true });
    }
    const files = [
      { name: CONFIG_FILE, generate: generateCommonTemplate },
      { name: PATTERNS_FILE, generate: generatePatternsTemplate },
      { name: TELEGRAM_FILE, generate: generateTelegramTemplate }
    ];
    let created = false;
    for (const file of files) {
      const filePath = join(cwdDir, file.name);
      if (!existsSync$1(filePath)) {
        writeFileSync(filePath, file.generate(), { encoding: "utf-8", mode: 384 });
        logger.info({ path: filePath }, `Created config file: ${file.name}`);
        created = true;
      }
    }
    if (created) {
      logger.info({ path: cwdDir }, "Config files created in .qlaude directory");
    }
    return created;
  } catch {
    return false;
  }
}
function loadGlobalTelegramConfig() {
  const globalPath = join(homedir(), QLAUDE_DIR, TELEGRAM_FILE);
  const raw = loadJsonFile(globalPath);
  if (!raw) return null;
  logger.info({ path: globalPath }, "Loading global Telegram credentials");
  return validateTelegramConfig(raw);
}
function loadConfig() {
  warnLegacyConfig();
  const globalTelegram = loadGlobalTelegramConfig();
  const qlaudeDir = resolveQlaudeDir();
  if (!qlaudeDir) {
    logger.debug("No .qlaude directory found, using defaults");
    return mergeAllWithDefaults(null, null, globalTelegram);
  }
  logger.info({ path: qlaudeDir }, "Loading config from .qlaude directory");
  migratePatternsFile(qlaudeDir);
  const commonRaw = loadJsonFile(join(qlaudeDir, CONFIG_FILE));
  const patternsRaw = loadJsonFile(join(qlaudeDir, PATTERNS_FILE));
  const telegramRaw = loadJsonFile(join(qlaudeDir, TELEGRAM_FILE));
  const common = commonRaw ? validateCommonConfig(commonRaw) : null;
  const patterns = patternsRaw ? validatePatternsConfig(patternsRaw) : null;
  const projectTelegram = telegramRaw ? validateTelegramConfig(telegramRaw) : null;
  const telegram = {
    ...globalTelegram,
    ...projectTelegram
  };
  return mergeAllWithDefaults(common, patterns, telegram);
}
function loadJsonFile(filePath) {
  if (!existsSync$1(filePath)) {
    return null;
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    logger.warn({ path: filePath, error }, "Failed to load config file");
    return null;
  }
}
function validateConversationLogConfig(obj) {
  if (typeof obj !== "object" || obj === null) {
    return null;
  }
  const config = {};
  const input = obj;
  if (typeof input.enabled === "boolean") {
    config.enabled = input.enabled;
  } else if (input.enabled !== void 0) {
    logger.warn({ value: input.enabled }, "Invalid conversationLog.enabled value, ignoring");
  }
  if (typeof input.filePath === "string" && input.filePath.length > 0) {
    config.filePath = input.filePath;
  } else if (input.filePath !== void 0) {
    logger.warn({ value: input.filePath }, "Invalid conversationLog.filePath value, ignoring");
  }
  if (typeof input.timestamps === "boolean") {
    config.timestamps = input.timestamps;
  } else if (input.timestamps !== void 0) {
    logger.warn({ value: input.timestamps }, "Invalid conversationLog.timestamps value, ignoring");
  }
  return config;
}
function validateTelegramConfig(obj) {
  if (typeof obj !== "object" || obj === null) {
    return null;
  }
  const config = {};
  const input = obj;
  if (typeof input.enabled === "boolean") {
    config.enabled = input.enabled;
  } else if (input.enabled !== void 0) {
    logger.warn({ value: input.enabled }, "Invalid telegram.enabled value, ignoring");
  }
  if (typeof input.botToken === "string") {
    config.botToken = input.botToken;
  } else if (input.botToken !== void 0) {
    logger.warn({ value: input.botToken }, "Invalid telegram.botToken value, ignoring");
  }
  if (typeof input.chatId === "string") {
    config.chatId = input.chatId;
  } else if (input.chatId !== void 0) {
    logger.warn({ value: input.chatId }, "Invalid telegram.chatId value, ignoring");
  }
  if (typeof input.confirmDelayMs === "number" && input.confirmDelayMs >= 0) {
    config.confirmDelayMs = input.confirmDelayMs;
  } else if (input.confirmDelayMs !== void 0) {
    logger.warn({ value: input.confirmDelayMs }, "Invalid telegram.confirmDelayMs value, ignoring");
  }
  if (input.templates !== void 0) {
    if (typeof input.templates === "object" && input.templates !== null) {
      const tpls = {};
      for (const [k, v] of Object.entries(input.templates)) {
        if (typeof v === "string") tpls[k] = v;
      }
      if (Object.keys(tpls).length > 0) config.templates = tpls;
    } else {
      logger.warn({ value: input.templates }, "Invalid telegram.templates value, ignoring");
    }
  }
  return config;
}
function validateCommonConfig(obj) {
  if (typeof obj !== "object" || obj === null) {
    return null;
  }
  const config = {};
  const input = obj;
  if (typeof input.startPaused === "boolean") {
    config.startPaused = input.startPaused;
  } else if (input.startPaused !== void 0) {
    logger.warn({ value: input.startPaused }, "Invalid startPaused value, ignoring");
  }
  if (typeof input.idleThresholdMs === "number" && input.idleThresholdMs > 0) {
    config.idleThresholdMs = input.idleThresholdMs;
  } else if (input.idleThresholdMs !== void 0) {
    logger.warn({ value: input.idleThresholdMs }, "Invalid idleThresholdMs value, ignoring");
  }
  if (typeof input.requiredStableChecks === "number" && input.requiredStableChecks > 0) {
    config.requiredStableChecks = input.requiredStableChecks;
  } else if (input.requiredStableChecks !== void 0) {
    logger.warn({ value: input.requiredStableChecks }, "Invalid requiredStableChecks value, ignoring");
  }
  const validLogLevels = ["trace", "debug", "info", "warn", "error", "fatal", "silent"];
  if (typeof input.logLevel === "string" && validLogLevels.includes(input.logLevel)) {
    config.logLevel = input.logLevel;
  } else if (input.logLevel !== void 0) {
    logger.warn({ value: input.logLevel }, "Invalid logLevel value, ignoring");
  }
  if (typeof input.logFile === "string" && input.logFile.length > 0) {
    config.logFile = input.logFile;
  } else if (input.logFile !== void 0) {
    logger.warn({ value: input.logFile }, "Invalid logFile value, ignoring");
  }
  if (input.conversationLog !== void 0) {
    const convLogConfig = validateConversationLogConfig(input.conversationLog);
    if (convLogConfig) {
      config.conversationLog = convLogConfig;
    }
  }
  return config;
}
function isValidPatternEntry(entry) {
  if (typeof entry === "string") return true;
  if (typeof entry === "object" && entry !== null) {
    const obj = entry;
    return typeof obj.pattern === "string" && (obj.flags === void 0 || typeof obj.flags === "string");
  }
  return false;
}
function validatePatternCategory(obj) {
  if (typeof obj !== "object" || obj === null) return null;
  const input = obj;
  const result = {};
  if (typeof input.enabled === "boolean") {
    result.enabled = input.enabled;
  }
  if (Array.isArray(input.patterns)) {
    result.patterns = input.patterns.filter(isValidPatternEntry);
  }
  return result;
}
function validatePatternsConfig(obj) {
  if (typeof obj !== "object" || obj === null) {
    logger.warn({ value: obj }, "Invalid patterns config, ignoring");
    return null;
  }
  const input = obj;
  const config = {};
  if (input.spinner !== void 0) {
    logger.warn('patterns.json contains "spinner" config which is no longer customizable — it will be ignored');
  }
  const categories = ["selectionPrompt", "interrupted", "taskFailure", "textInputKeywords"];
  for (const key of categories) {
    if (input[key] !== void 0) {
      const validated = validatePatternCategory(input[key]);
      if (validated) {
        config[key] = validated;
      }
    }
  }
  if (input.optionParse !== void 0 && typeof input.optionParse === "object" && input.optionParse !== null) {
    const op = input.optionParse;
    config.optionParse = {};
    if (typeof op.enabled === "boolean") config.optionParse.enabled = op.enabled;
    if (typeof op.pattern === "string") config.optionParse.pattern = op.pattern;
    if (typeof op.flags === "string") config.optionParse.flags = op.flags;
  }
  if (input.tipFilter !== void 0 && typeof input.tipFilter === "object" && input.tipFilter !== null) {
    const tf = input.tipFilter;
    config.tipFilter = {};
    if (typeof tf.enabled === "boolean") config.tipFilter.enabled = tf.enabled;
    if (Array.isArray(tf.keywords) && tf.keywords.every((k) => typeof k === "string")) {
      config.tipFilter.keywords = tf.keywords;
    }
  }
  if (input.promptSeparator !== void 0 && typeof input.promptSeparator === "object" && input.promptSeparator !== null) {
    const ps = input.promptSeparator;
    config.promptSeparator = {};
    if (typeof ps.enabled === "boolean") config.promptSeparator.enabled = ps.enabled;
    if (typeof ps.pattern === "string") config.promptSeparator.pattern = ps.pattern;
    if (typeof ps.minLength === "number" && ps.minLength > 0) config.promptSeparator.minLength = ps.minLength;
  }
  return config;
}
function mergeAllWithDefaults(common, patterns, telegram) {
  return {
    ...DEFAULT_CONFIG,
    ...common,
    conversationLog: {
      ...DEFAULT_CONVERSATION_LOG_CONFIG,
      ...common?.conversationLog
    },
    telegram: {
      ...DEFAULT_TELEGRAM_CONFIG,
      ...telegram
    },
    patterns: patterns ?? void 0
  };
}
function getSessionLabelsPath() {
  return join(process.cwd(), QLAUDE_DIR, "session-labels.json");
}
function readSessionLabels() {
  const filePath = getSessionLabelsPath();
  if (!existsSync$1(filePath)) {
    return {};
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    logger.error({ err, filePath }, "Failed to read session labels");
    return {};
  }
}
function writeSessionLabels(labels) {
  const filePath = getSessionLabelsPath();
  try {
    const dir = dirname$1(filePath);
    if (!existsSync$1(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(labels, null, 2), { encoding: "utf-8", mode: 384 });
  } catch (err) {
    logger.error({ err, filePath }, "Failed to write session labels");
    throw err;
  }
}
function saveSessionLabel(label, sessionId) {
  const labels = readSessionLabels();
  const wasOverwritten = label in labels;
  labels[label] = sessionId;
  writeSessionLabels(labels);
  logger.info({ label, sessionId, wasOverwritten }, "Session label saved");
  return wasOverwritten;
}
function getSessionLabel(label) {
  const labels = readSessionLabels();
  return labels[label] || null;
}
class AutoExecutor extends EventEmitter {
  static MAX_RESTART_RETRIES = 1;
  static RESTART_RETRY_DELAY_MS = 1e3;
  static MAX_CRASH_RECOVERIES = 3;
  deps;
  enabled;
  pendingNewSessionItem = null;
  currentExecutingItem = null;
  restartRetryCount = 0;
  crashRecoveryCount = 0;
  queueExecutionActive = false;
  executeInProgress = false;
  pendingExecuteRequest = false;
  emit(event, ...args) {
    return super.emit(event, ...args);
  }
  on(event, listener) {
    return super.on(event, listener);
  }
  constructor(deps, config = {}) {
    super();
    this.deps = deps;
    this.enabled = config.enabled ?? true;
    this.setupEventListeners();
  }
  /**
   * Set up event listeners for state changes
   */
  setupEventListeners() {
    this.deps.stateDetector.on("state_change", (state) => {
      if (state.type === "READY" && this.enabled) {
        if (state.metadata?.hasSpinner) {
          this.handleSpinnerDetected();
          return;
        }
        this.executeNext();
      } else if (state.type === "TASK_FAILED" && this.enabled) {
        void this.handleTaskFailed(state.metadata?.failureReason);
      } else if (this.isBlockingState(state.type) && this.enabled) {
        this.showPausedMessage(state.type);
      }
    });
  }
  /**
   * Handle spinner detected during READY state
   * Pause auto-execution and notify user as safety measure
   */
  handleSpinnerDetected() {
    const queueLength = this.deps.queueManager.getLength();
    if (queueLength === 0) return;
    this.deps.display.showMessage("warning", "[Queue] Spinner detected - pausing for safety. Use :resume to continue.");
    this.emit("spinner_detected");
    logger.info({ queueLength }, "Auto-execution paused due to spinner detection");
  }
  /**
   * Handle task failure with explicit QUEUE_STOP marker or rate limit
   * Re-adds the failed item to queue front for retry, then stops auto-execution
   */
  async handleTaskFailed(reason) {
    if (this.currentExecutingItem) {
      try {
        await this.deps.queueManager.prependItem(
          this.currentExecutingItem.prompt,
          this.toAddItemOptions(this.currentExecutingItem)
        );
        logger.info(
          { prompt: this.currentExecutingItem.prompt.substring(0, 50) },
          "Failed item re-added to queue front for retry"
        );
      } catch (err) {
        logger.error({ err }, "Failed to re-add item to queue");
      }
      this.currentExecutingItem = null;
    }
    this.deps.display.setCurrentItem(null);
    const queueLength = this.deps.queueManager.getLength();
    this.stop();
    this.deps.display.setPaused(true);
    const reasonText = reason ? `: ${reason}` : "";
    const itemText = queueLength === 1 ? "1 item" : `${queueLength} items`;
    this.deps.display.showMessage("error", `[Queue] Task failed${reasonText}. Auto-execution stopped (${itemText} remaining).`);
    this.emit("task_failed", reason);
    this.deps.telegramNotifier?.notify("task_failed", {
      queueLength,
      message: reason
    });
    this.deps.terminalEmulator?.clear();
    logger.warn({ reason, queueLength }, "Queue execution stopped due to task failure (QUEUE_STOP or rate limit)");
  }
  /**
   * Check if a state type is a blocking state (safety guard)
   * Note: INTERRUPTED removed - high false positive rate from code content matching patterns
   */
  isBlockingState(stateType) {
    return ["SELECTION_PROMPT", "TASK_FAILED"].includes(stateType);
  }
  /**
   * Show paused message when blocking state is detected
   */
  showPausedMessage(stateType) {
    const queueLength = this.deps.queueManager.getLength();
    if (queueLength === 0) return;
    const itemText = queueLength === 1 ? "1 item" : `${queueLength} items`;
    this.deps.display.showMessage("warning", `[Queue] Paused (${itemText}) - waiting for user input`);
    this.emit("paused", stateType);
    logger.info({ stateType, queueLength }, "Auto-execution paused due to blocking state");
  }
  /**
   * Execute the next item in the queue
   */
  async executeNext() {
    if (this.executeInProgress) {
      this.pendingExecuteRequest = true;
      logger.debug("executeNext already in progress, queueing follow-up READY trigger");
      return;
    }
    this.executeInProgress = true;
    try {
      if (!this.deps.ptyWrapper.isRunning()) {
        logger.warn("PTY not running, skipping queue execution");
        return;
      }
      if (this.pendingNewSessionItem) {
        const item = this.pendingNewSessionItem;
        this.pendingNewSessionItem = null;
        if (!item.prompt.trim()) {
          logger.debug("Skipping empty pending new session prompt");
          this.currentExecutingItem = null;
          return;
        }
        this.deps.display.setCurrentItem(item);
        this.deps.ptyWrapper.write(item.prompt);
        await new Promise((resolve2) => setTimeout(resolve2, 50));
        this.deps.ptyWrapper.write("\r");
        this.emit("executed", item);
        this.currentExecutingItem = null;
        logger.info({ prompt: item.prompt.substring(0, 50) }, "Pending new session item executed");
        return;
      }
      try {
        const item = await this.deps.queueManager.popNextItem();
        if (!item) {
          this.deps.display.setCurrentItem(null);
          logger.debug({ queueExecutionActive: this.queueExecutionActive }, "Queue empty, checking queue_completed condition");
          if (this.queueExecutionActive) {
            this.queueExecutionActive = false;
            this.emit("queue_completed");
            this.deps.telegramNotifier?.notify("queue_completed");
            logger.info("Queue execution completed (queue_completed event emitted)");
          }
          logger.debug("Queue empty, auto-execution idle");
          return;
        }
        this.currentExecutingItem = item;
        logger.debug({ queueExecutionActive: this.queueExecutionActive }, "Checking queue_started condition");
        if (!this.queueExecutionActive) {
          this.queueExecutionActive = true;
          this.emit("queue_started");
          this.deps.telegramNotifier?.notify("queue_started", {
            queueLength: this.deps.queueManager.getLength() + 1
            // +1 because we just popped the current item
          });
          logger.info("Queue execution started (queue_started event emitted)");
        }
        this.deps.conversationLogger?.logQueueItem(item);
        if (item.isBreakpoint) {
          this.deps.display.setCurrentItem(null);
          if (item.prompt) {
            this.deps.display.showMessage("info", `[Queue] Breakpoint: "${item.prompt}"`);
          } else {
            this.deps.display.showMessage("info", "[Queue] Breakpoint reached");
          }
          this.stop();
          this.deps.display.setPaused(true);
          this.deps.display.showMessage("warning", "[Queue] Auto-execution paused. Use :resume to continue.");
          this.deps.terminalEmulator?.clear();
          this.deps.telegramNotifier?.notify("breakpoint", {
            queueLength: this.deps.queueManager.getLength(),
            message: item.prompt
          });
          logger.info({ comment: item.prompt }, "Breakpoint reached, auto-execution paused");
          return;
        }
        if (item.labelSession) {
          this.deps.conversationLogger?.refreshSessionId();
          const sessionId = this.deps.conversationLogger?.getCurrentSessionId() ?? null;
          if (sessionId) {
            const wasOverwritten = saveSessionLabel(item.labelSession, sessionId);
            if (wasOverwritten) {
              this.deps.display.showMessage("warning", `[Queue] Label "${item.labelSession}" overwritten`);
            }
            this.deps.display.showMessage("success", `[Queue] Session labeled: "${item.labelSession}"`);
            logger.info({ label: item.labelSession, sessionId, wasOverwritten }, "Session labeled");
          } else {
            logger.warn({ label: item.labelSession }, "No session ID available for labeling");
            await this.handleTaskFailed("No active session to label");
            return;
          }
          this.deps.stateDetector.reset();
          return;
        }
        if (item.loadSessionLabel) {
          const sessionId = getSessionLabel(item.loadSessionLabel);
          if (sessionId) {
            item.resumeSessionId = sessionId;
            this.deps.display.showMessage("info", `[Queue] Loading session: "${item.loadSessionLabel}"`);
            logger.info({ label: item.loadSessionLabel, sessionId }, "Session label resolved");
          } else {
            logger.warn({ label: item.loadSessionLabel }, "Session label not found at execution time");
            await this.handleTaskFailed(`Session not found: "${item.loadSessionLabel}"`);
            return;
          }
        }
        if (item.delayMs) {
          this.deps.display.showMessage("info", `[Queue] Waiting ${item.delayMs}ms...`);
          this.emit("executed", item);
          this.currentExecutingItem = null;
          await new Promise((resolve2) => setTimeout(resolve2, item.delayMs));
          logger.info({ delayMs: item.delayMs }, "Delay completed");
          void this.executeNext();
          return;
        }
        if (item.isNewSession || item.resumeSessionId) {
          await this.handleNewSession(item);
          return;
        }
        if (!item.prompt.trim()) {
          logger.debug("Skipping empty prompt");
          this.currentExecutingItem = null;
          return;
        }
        this.deps.display.setCurrentItem(item);
        this.deps.ptyWrapper.write(item.prompt);
        await new Promise((resolve2) => setTimeout(resolve2, 50));
        this.deps.ptyWrapper.write("\r");
        this.emit("executed", item);
        this.currentExecutingItem = null;
        this.crashRecoveryCount = 0;
        logger.info({ prompt: item.prompt.substring(0, 50) }, "Queue item executed");
      } catch (error) {
        logger.error({ error }, "Failed to execute queue item");
      }
    } finally {
      this.executeInProgress = false;
      if (this.pendingExecuteRequest) {
        this.pendingExecuteRequest = false;
        void this.executeNext();
      }
    }
  }
  /**
   * Handle new session item - restart PTY and queue prompt for execution after ready
   * Supports --resume for loading saved sessions
   */
  async handleNewSession(item) {
    if (item.resumeSessionId) {
      this.deps.display.showMessage("info", "[Queue] Loading saved session...");
    } else {
      this.deps.display.showMessage("info", NEW_SESSION_MESSAGES.STARTING);
    }
    try {
      let args = this.deps.getClaudeArgs();
      if (item.resumeSessionId) {
        args = ["--resume", item.resumeSessionId, ...args];
        logger.info({ sessionId: item.resumeSessionId }, "Resuming session with --resume");
      }
      await this.deps.ptyWrapper.restart(args);
      this.restartRetryCount = 0;
      if (item.prompt) {
        this.pendingNewSessionItem = item;
        this.deps.display.setCurrentItem(item);
      }
      this.emit("session_restart", item);
      logger.info({
        prompt: item.prompt ? item.prompt.substring(0, 50) : "(no prompt)",
        resumeSessionId: item.resumeSessionId ? "***" : void 0
      }, "New session started");
    } catch (error) {
      logger.error({ error, retryCount: this.restartRetryCount }, "Failed to start new session");
      if (this.restartRetryCount < AutoExecutor.MAX_RESTART_RETRIES) {
        this.restartRetryCount++;
        logger.info({ retryCount: this.restartRetryCount }, "Retrying new session start");
        await new Promise((resolve2) => setTimeout(resolve2, AutoExecutor.RESTART_RETRY_DELAY_MS));
        return this.handleNewSession(item);
      }
      this.restartRetryCount = 0;
      this.deps.display.showMessage("error", NEW_SESSION_MESSAGES.FAILED_MAX_RETRIES);
      try {
        await this.deps.queueManager.prependItem(item.prompt, this.toAddItemOptions(item));
        logger.info("Failed new session item re-added to queue front for later retry");
      } catch (queueError) {
        logger.error({ queueError }, "Failed to re-add item to queue");
      }
      this.currentExecutingItem = null;
      this.stop();
      this.deps.display.setPaused(true);
      this.emit("task_failed", NEW_SESSION_MESSAGES.FAILED);
      this.deps.telegramNotifier?.notify("task_failed", {
        queueLength: this.deps.queueManager.getLength(),
        message: NEW_SESSION_MESSAGES.FAILED
      });
      this.deps.terminalEmulator?.clear();
    }
  }
  /**
   * Start auto-execution
   */
  start() {
    this.enabled = true;
    logger.info("Auto-executor started");
  }
  /**
   * Stop auto-execution
   */
  stop() {
    this.enabled = false;
    logger.info("Auto-executor stopped");
  }
  /**
   * Check if auto-execution is enabled
   */
  isEnabled() {
    return this.enabled;
  }
  /**
   * Check if PTY exit happened during a session load (recoverable)
   * Returns true if there's a pending new session item waiting for READY
   */
  hasPendingSessionLoad() {
    return this.pendingNewSessionItem !== null || !!this.currentExecutingItem?.resumeSessionId;
  }
  /**
   * Handle PTY exit during session load (--resume failed)
   * Treats it as a task failure: re-adds item to queue, pauses, notifies
   */
  async handlePtyExitDuringSessionLoad() {
    const item = this.pendingNewSessionItem ?? this.currentExecutingItem;
    if (!item || !item.resumeSessionId) return;
    this.pendingNewSessionItem = null;
    this.currentExecutingItem = null;
    this.deps.display.setCurrentItem(null);
    try {
      await this.deps.queueManager.prependItem(item.prompt, this.toAddItemOptions(item));
      logger.info(
        { prompt: item.prompt.substring(0, 50), resumeSessionId: item.resumeSessionId ? "***" : void 0 },
        "Session load failed item re-added to queue front"
      );
    } catch (err) {
      logger.error({ err }, "Failed to re-add session load item to queue");
    }
    const queueLength = this.deps.queueManager.getLength();
    this.stop();
    this.deps.display.setPaused(true);
    const label = item.loadSessionLabel ? `"${item.loadSessionLabel}"` : "unknown";
    this.deps.display.showMessage("error", `[Queue] Session load failed (${label}). Auto-execution stopped (${queueLength} items remaining).`);
    this.emit("task_failed", `Session load failed: ${label}`);
    this.deps.telegramNotifier?.notify("task_failed", {
      queueLength,
      message: `Session load failed: ${label}`
    });
    this.deps.terminalEmulator?.clear();
    logger.warn({ label, queueLength }, "Session load failed, auto-execution stopped");
  }
  /**
   * Check if queue execution is currently active
   */
  isQueueActive() {
    return this.queueExecutionActive && this.enabled;
  }
  /**
   * Handle PTY crash during queue execution.
   * Re-adds the current executing item to queue front for retry after restart.
   * Returns false if max crash recoveries exceeded (caller should not restart PTY).
   */
  async handlePtyCrashRecovery() {
    this.crashRecoveryCount++;
    logger.warn(
      { crashRecoveryCount: this.crashRecoveryCount, max: AutoExecutor.MAX_CRASH_RECOVERIES },
      "Crash recovery attempt"
    );
    const itemsToRecover = [];
    if (this.currentExecutingItem) {
      itemsToRecover.push(this.currentExecutingItem);
    }
    if (this.pendingNewSessionItem && !itemsToRecover.includes(this.pendingNewSessionItem)) {
      itemsToRecover.push(this.pendingNewSessionItem);
    }
    for (let i = itemsToRecover.length - 1; i >= 0; i--) {
      const item = itemsToRecover[i];
      try {
        await this.deps.queueManager.prependItem(item.prompt, this.toAddItemOptions(item));
        logger.info(
          { prompt: item.prompt.substring(0, 50), resumeSessionId: item.resumeSessionId ? "***" : void 0 },
          "Crashed item re-added to queue front"
        );
      } catch (err) {
        logger.error({ err }, "Failed to re-add crashed item to queue");
      }
    }
    this.currentExecutingItem = null;
    this.pendingNewSessionItem = null;
    this.deps.display.setCurrentItem(null);
    this.deps.stateDetector.reset();
    this.deps.terminalEmulator?.clear();
    if (this.crashRecoveryCount >= AutoExecutor.MAX_CRASH_RECOVERIES) {
      const queueLength = this.deps.queueManager.getLength();
      this.crashRecoveryCount = 0;
      this.stop();
      this.deps.display.setPaused(true);
      this.deps.display.showMessage(
        "error",
        `[Queue] Claude Code crashed ${AutoExecutor.MAX_CRASH_RECOVERIES} times consecutively. Auto-execution stopped (${queueLength} items remaining).`
      );
      this.emit("task_failed", "Repeated PTY crashes");
      this.deps.telegramNotifier?.notify("task_failed", {
        queueLength,
        message: `PTY crashed ${AutoExecutor.MAX_CRASH_RECOVERIES} times consecutively`
      });
      logger.error(
        { crashCount: AutoExecutor.MAX_CRASH_RECOVERIES, queueLength },
        "Max crash recoveries exceeded, stopping queue"
      );
      return false;
    }
    return true;
  }
  /**
   * Convert QueueItem to add/prepend options while preserving metadata.
   */
  toAddItemOptions(item) {
    return {
      isNewSession: item.isNewSession,
      isBreakpoint: item.isBreakpoint,
      labelSession: item.labelSession,
      resumeSessionId: item.resumeSessionId,
      loadSessionLabel: item.loadSessionLabel,
      isMultiline: item.isMultiline,
      modelName: item.modelName,
      delayMs: item.delayMs
    };
  }
}
const KNOWN_QUEUE_DIRECTIVES = ["new", "save", "load", "pause", "model", "delay"];
const INTERACTIVE_ONLY_DIRECTIVES = ["add", "drop", "clear", "resume", "reload", "status", "help", "list"];
const RETRY_COUNT = 2;
const RETRY_DELAY_MS = 100;
function delay(ms) {
  return new Promise((resolve2) => setTimeout(resolve2, ms));
}
class QueueManager extends EventEmitter$1 {
  items = [];
  filePath;
  fileErrorState = false;
  operationQueue = Promise.resolve();
  constructor(filePath = ".qlaude/queue") {
    super();
    this.filePath = filePath;
  }
  /**
   * Serialize mutating file operations to avoid read-modify-write races.
   */
  runExclusive(operation) {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  /**
   * Handle file recovery - emit event if recovering from error state
   */
  handleFileRecovery() {
    if (this.fileErrorState) {
      this.fileErrorState = false;
      this.emit("file_recovered");
      logger.info({ filePath: this.filePath }, "Queue file recovered");
    }
  }
  /**
   * Load queue from file
   * Returns fileFound status and count of skipped invalid lines
   * On persistent failure, keeps in-memory queue and emits error event
   */
  async loadFromFile() {
    let lastError;
    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
      try {
        const content = await fs.readFile(this.filePath, "utf-8");
        const { items, skippedLines } = this.parseQueueFile(content);
        this.items = items;
        logger.debug({ filePath: this.filePath, itemCount: this.items.length }, "Queue file loaded");
        this.handleFileRecovery();
        return { fileFound: true, skippedLines, readError: false };
      } catch (err) {
        const error = err;
        if (error.code === "ENOENT") {
          this.handleFileRecovery();
          try {
            await fs.writeFile(this.filePath, "", { mode: 384 });
            logger.debug({ filePath: this.filePath }, "Queue file created (empty)");
          } catch {
          }
          logger.debug({ filePath: this.filePath }, "Queue file not found, initialized empty queue");
          return { fileFound: false, skippedLines: 0, readError: false };
        }
        lastError = error;
        logger.warn({ err: error, attempt: attempt + 1 }, "Failed to read queue file, retrying");
        if (attempt < RETRY_COUNT) {
          await delay(RETRY_DELAY_MS);
        }
      }
    }
    if (!this.fileErrorState) {
      this.fileErrorState = true;
      this.emit("file_read_error");
    }
    logger.error(
      { err: lastError, filePath: this.filePath },
      "Queue file read failed, using in-memory queue"
    );
    return { fileFound: false, skippedLines: 0, readError: true };
  }
  /**
   * Save queue to file
   * On persistent failure, emits error event but doesn't throw
   */
  async saveToFile() {
    let lastError;
    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
      try {
        const content = this.serializeQueue();
        await fs.writeFile(this.filePath, content, { mode: 384 });
        logger.debug({ filePath: this.filePath }, "Queue file saved");
        this.handleFileRecovery();
        return true;
      } catch (err) {
        const error = err;
        lastError = error;
        logger.warn({ err: error, attempt: attempt + 1 }, "Failed to write queue file, retrying");
        if (attempt < RETRY_COUNT) {
          await delay(RETRY_DELAY_MS);
        }
      }
    }
    if (!this.fileErrorState) {
      this.fileErrorState = true;
      this.emit("file_write_error");
    }
    logger.error(
      { err: lastError, filePath: this.filePath },
      "Queue file write failed, changes may be lost"
    );
    return false;
  }
  /**
   * Parse queue file content into QueueItem array
   * Format (@ prefix for directives, bare text for prompts):
   *   bare text             → regular prompt
   *   # comment             → skipped
   *   @new                  → new session (next line is the prompt)
   *   @save name            → label session
   *   @load name            → load session
   *   @pause [reason]       → breakpoint (pause auto-execution)
   *   @(  ... @)            → multiline prompt
   *   \@text                → escaped: prompt "@text"
   *   \\@text               → escaped: prompt "\@text"
   */
  parseQueueFile(content) {
    const lines = content.replace(/\r\n/g, "\n").split("\n");
    const items = [];
    let skippedLines = 0;
    let inMultilineBlock = false;
    let multilineLines = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmedLine = line.trim();
      if (inMultilineBlock) {
        if (trimmedLine === "@)") {
          const prompt = multilineLines.join("\n");
          items.push({
            prompt,
            isNewSession: false,
            isMultiline: true
          });
          inMultilineBlock = false;
          multilineLines = [];
          continue;
        }
        multilineLines.push(line);
        continue;
      }
      if (trimmedLine === "@(") {
        inMultilineBlock = true;
        multilineLines = [];
        continue;
      }
      if (!trimmedLine || trimmedLine.startsWith("#")) {
        skippedLines++;
        continue;
      }
      if (trimmedLine.startsWith("\\\\@")) {
        items.push({ prompt: trimmedLine.slice(1), isNewSession: false });
        continue;
      }
      if (trimmedLine.startsWith("\\@")) {
        items.push({ prompt: trimmedLine.slice(1), isNewSession: false });
        continue;
      }
      if (trimmedLine.startsWith("@")) {
        const rest = trimmedLine.slice(1);
        const spaceIdx = rest.indexOf(" ");
        const dirName = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).toLowerCase();
        const args = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();
        if (INTERACTIVE_ONLY_DIRECTIVES.includes(dirName)) {
          logger.warn({ directive: dirName, line: i + 1 }, "Interactive-only command used as @directive in queue file, treating as prompt");
          items.push({ prompt: trimmedLine, isNewSession: false });
          continue;
        }
        if (KNOWN_QUEUE_DIRECTIVES.includes(dirName)) {
          switch (dirName) {
            case "new":
              items.push({ prompt: "", isNewSession: true });
              continue;
            case "pause":
              items.push({ prompt: args, isNewSession: false, isBreakpoint: true });
              continue;
            case "save":
              if (args) {
                items.push({ prompt: "", isNewSession: false, labelSession: args });
              }
              continue;
            case "load": {
              const label = args || "";
              if (label) {
                items.push({ prompt: "", isNewSession: true, loadSessionLabel: label });
              }
              continue;
            }
            case "model":
              if (args) {
                items.push({ prompt: `/model ${args}`, isNewSession: false, modelName: args });
              }
              continue;
            case "delay": {
              const ms = parseInt(args, 10);
              if (ms > 0) {
                items.push({ prompt: "", isNewSession: false, delayMs: ms });
              }
              continue;
            }
          }
        }
        logger.warn({ directive: dirName, line: i + 1 }, "Unknown @directive in queue file, treating as prompt");
        items.push({ prompt: trimmedLine, isNewSession: false });
        continue;
      }
      items.push({ prompt: trimmedLine, isNewSession: false });
    }
    if (inMultilineBlock && multilineLines.length > 0) {
      logger.warn("Unclosed multiline block in queue file");
      items.push({
        prompt: multilineLines.join("\n"),
        isNewSession: false,
        isMultiline: true
      });
    }
    return { items, skippedLines };
  }
  /**
   * Serialize queue items to file format (@ directives)
   */
  serializeQueue() {
    return this.items.map((item) => {
      if (item.labelSession) {
        return `@save ${item.labelSession}`;
      }
      if (item.loadSessionLabel) {
        return `@load ${item.loadSessionLabel}`;
      }
      if (item.resumeSessionId) {
        return "@new";
      }
      if (item.isBreakpoint) {
        return item.prompt ? `@pause ${item.prompt}` : "@pause";
      }
      if (item.modelName) {
        return `@model ${item.modelName}`;
      }
      if (item.delayMs) {
        return `@delay ${item.delayMs}`;
      }
      if (item.isMultiline) {
        const prefix = item.isNewSession ? "@new\n" : "";
        return `${prefix}@(
${item.prompt}
@)`;
      }
      if (item.isNewSession) {
        return "@new";
      }
      if (item.prompt.startsWith("\\@")) {
        return `\\${item.prompt}`;
      }
      if (item.prompt.startsWith("@")) {
        return `\\${item.prompt}`;
      }
      return item.prompt;
    }).join("\n");
  }
  /**
   * Build a QueueItem from a prompt and options. Shared by addItem and prependItem.
   */
  buildQueueItem(prompt, options) {
    const modelName = options.modelName?.trim() || void 0;
    const delayMs = options.delayMs && options.delayMs > 0 ? options.delayMs : void 0;
    return {
      prompt,
      isNewSession: options.isNewSession ?? false,
      isBreakpoint: options.isBreakpoint,
      labelSession: options.labelSession,
      resumeSessionId: options.resumeSessionId,
      loadSessionLabel: options.loadSessionLabel,
      isMultiline: options.isMultiline,
      modelName,
      delayMs,
      addedAt: /* @__PURE__ */ new Date()
    };
  }
  /**
   * Emit a queue event
   */
  emitEvent(type, item) {
    const event = {
      type,
      item,
      queueLength: this.items.length,
      timestamp: /* @__PURE__ */ new Date()
    };
    this.emit(type, event);
  }
  /**
   * Add item to the end of the queue
   * @param prompt The prompt text (can be empty for Label/Load commands)
   * @param optionsOrIsNewSession Either AddItemOptions object or boolean for backward compatibility
   */
  async addItem(prompt, optionsOrIsNewSession = false) {
    return this.runExclusive(async () => {
      await this.loadFromFile();
      const options = typeof optionsOrIsNewSession === "boolean" ? { isNewSession: optionsOrIsNewSession } : optionsOrIsNewSession;
      const item = this.buildQueueItem(prompt, options);
      this.items.push(item);
      await this.saveToFile();
      logger.info({
        prompt: prompt.substring(0, 50),
        isNewSession: item.isNewSession,
        isBreakpoint: item.isBreakpoint,
        labelSession: item.labelSession,
        resumeSessionId: item.resumeSessionId ? "***" : void 0,
        isMultiline: item.isMultiline
      }, "Item added to queue");
      this.emitEvent("item_added", item);
    });
  }
  /**
   * Add item to the FRONT of the queue (for retry on failure)
   * Used when a task fails and needs to be retried
   */
  async prependItem(prompt, options = {}) {
    return this.runExclusive(async () => {
      await this.loadFromFile();
      const item = this.buildQueueItem(prompt, options);
      this.items.unshift(item);
      await this.saveToFile();
      logger.info({
        prompt: prompt.substring(0, 50),
        isNewSession: item.isNewSession
      }, "Item prepended to queue front");
      this.emitEvent("item_added", item);
    });
  }
  /**
   * Remove and return the last item from the queue
   */
  async removeLastItem() {
    return this.runExclusive(async () => {
      await this.loadFromFile();
      if (this.items.length === 0) {
        return null;
      }
      const item = this.items.pop();
      await this.saveToFile();
      logger.info({ prompt: item.prompt.substring(0, 50) }, "Last item removed from queue");
      this.emitEvent("item_removed", item);
      return item;
    });
  }
  /**
   * Get all items in the queue (in-memory)
   */
  getItems() {
    return [...this.items];
  }
  /**
   * Get the next item in the queue without removing it (in-memory)
   */
  getNextItem() {
    return this.items.length > 0 ? this.items[0] : null;
  }
  /**
   * Pop and return the next (first) item from the queue
   */
  async popNextItem() {
    return this.runExclusive(async () => {
      await this.loadFromFile();
      if (this.items.length === 0) {
        return null;
      }
      const item = this.items.shift();
      await this.saveToFile();
      logger.info({ prompt: item.prompt.substring(0, 50) }, "Next item popped from queue");
      this.emitEvent("item_executed", item);
      return item;
    });
  }
  /**
   * Get the number of items in the queue (in-memory)
   */
  getLength() {
    return this.items.length;
  }
  /**
   * Reload queue from file and return reload result
   */
  async reload() {
    return this.runExclusive(async () => {
      const loadResult = await this.loadFromFile();
      const result = {
        success: true,
        fileFound: loadResult.fileFound,
        itemCount: this.items.length,
        skippedLines: loadResult.skippedLines
      };
      logger.info({ ...result }, "Queue reloaded");
      this.emitEvent("queue_reloaded");
      return result;
    });
  }
}
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
function isValidSessionId(sessionId) {
  return SESSION_ID_PATTERN.test(sessionId);
}
function getClaudeProjectsDir() {
  return join(homedir(), ".claude", "projects");
}
function cwdToProjectFolder(cwd) {
  return cwd.replace(/^-+/, "").toLowerCase().replace(/-+/g, "-");
}
function findProjectFolder(cwd) {
  const projectsDir = getClaudeProjectsDir();
  const expectedName = cwdToProjectFolder(cwd);
  if (!existsSync$1(projectsDir)) {
    return null;
  }
  const variations = [
    expectedName,
    expectedName.charAt(0).toUpperCase() + expectedName.slice(1)
  ];
  for (const variation of variations) {
    const fullPath = join(projectsDir, variation);
    if (existsSync$1(fullPath)) {
      return fullPath;
    }
  }
  return null;
}
function getSessionFilePath(cwd, sessionId) {
  if (!isValidSessionId(sessionId)) {
    logger.warn({ sessionId }, "Invalid session ID format, rejecting");
    return null;
  }
  const projectFolder = findProjectFolder(cwd);
  if (!projectFolder) {
    return null;
  }
  const jsonlPath = join(projectFolder, `${sessionId}.jsonl`);
  if (existsSync$1(jsonlPath)) {
    return jsonlPath;
  }
  return null;
}
function extractConversations(sessionFilePath) {
  if (!existsSync$1(sessionFilePath)) {
    logger.warn({ sessionFilePath }, "Session file not found");
    return [];
  }
  const conversations = [];
  let currentQuestion = null;
  let currentAnswer = "";
  try {
    const content = readFileSync(sessionFilePath, "utf-8");
    const lines = content.trim().split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "user" && msg.message?.role === "user") {
          if (currentQuestion && currentAnswer) {
            conversations.push({
              timestamp: currentQuestion.timestamp,
              question: currentQuestion.text,
              answer: currentAnswer.trim()
            });
          }
          const content2 = msg.message.content;
          let questionText = "";
          if (typeof content2 === "string") {
            questionText = content2;
          } else if (Array.isArray(content2)) {
            for (const block of content2) {
              if (block.type === "text" && block.text) {
                questionText = block.text;
                break;
              }
            }
          }
          if (questionText && !isToolResult(content2)) {
            currentQuestion = {
              text: questionText,
              timestamp: msg.timestamp || (/* @__PURE__ */ new Date()).toISOString()
            };
            currentAnswer = "";
          }
        }
        if (msg.type === "assistant" && msg.message?.role === "assistant") {
          const content2 = msg.message.content;
          if (Array.isArray(content2)) {
            for (const block of content2) {
              if (block.type === "text" && block.text) {
                if (currentAnswer) {
                  currentAnswer += "\n";
                }
                currentAnswer += block.text;
              }
            }
          }
        }
      } catch {
        continue;
      }
    }
    if (currentQuestion && currentAnswer) {
      conversations.push({
        timestamp: currentQuestion.timestamp,
        question: currentQuestion.text,
        answer: currentAnswer.trim()
      });
    }
  } catch (err) {
    logger.error({ err, sessionFilePath }, "Failed to extract conversations");
  }
  return deduplicateConversations(conversations);
}
function deduplicateConversations(conversations) {
  const seen = /* @__PURE__ */ new Map();
  for (const entry of conversations) {
    const timestampKey = entry.timestamp.slice(0, 19);
    const questionKey = entry.question.slice(0, 100);
    const key = `${timestampKey}|${questionKey}`;
    const existing = seen.get(key);
    if (!existing || entry.answer.length > existing.answer.length) {
      seen.set(key, entry);
    }
  }
  return Array.from(seen.values());
}
function isToolResult(content) {
  if (typeof content === "string") {
    return false;
  }
  if (Array.isArray(content)) {
    return content.some((block) => block.type === "tool_result");
  }
  return false;
}
function formatConversationsForLog(conversations, includeTimestamps = true) {
  if (conversations.length === 0) {
    return "";
  }
  const lines = [];
  for (const entry of conversations) {
    if (includeTimestamps) {
      const timestamp = new Date(entry.timestamp).toISOString().replace("T", " ").slice(0, -1);
      lines.push(`[${timestamp}]`);
    }
    lines.push(`Q: ${entry.question}`);
    lines.push("");
    lines.push(`A: ${entry.answer}`);
    lines.push("");
    lines.push("─".repeat(60));
    lines.push("");
  }
  return lines.join("\n");
}
function getSessionIdFilePath(cwd = process.cwd()) {
  return join(cwd, ".qlaude", "session");
}
function readSessionId(cwd = process.cwd()) {
  const sessionFile = getSessionIdFilePath(cwd);
  if (!existsSync$1(sessionFile)) {
    return null;
  }
  try {
    const content = readFileSync(sessionFile, "utf-8").trim();
    return content || null;
  } catch {
    return null;
  }
}
function deleteSessionId(cwd = process.cwd()) {
  const sessionFile = getSessionIdFilePath(cwd);
  if (existsSync$1(sessionFile)) {
    unlinkSync(sessionFile);
  }
}
function getSessionLogOffsetsPath() {
  return join(process.cwd(), QLAUDE_DIR, "session-log-offsets.json");
}
function readSessionLogOffsets() {
  const filePath = getSessionLogOffsetsPath();
  if (!existsSync$1(filePath)) {
    return {};
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    logger.error({ err, filePath }, "Failed to read session log offsets");
    return {};
  }
}
function writeSessionLogOffsets(offsets) {
  const filePath = getSessionLogOffsetsPath();
  try {
    const dir = dirname$1(filePath);
    if (!existsSync$1(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(filePath, JSON.stringify(offsets, null, 2), "utf-8");
  } catch (err) {
    logger.error({ err, filePath }, "Failed to write session log offsets");
  }
}
function getSessionLogOffset(sessionId) {
  const offsets = readSessionLogOffsets();
  return offsets[sessionId] ?? 0;
}
function saveSessionLogOffset(sessionId, count) {
  const offsets = readSessionLogOffsets();
  offsets[sessionId] = count;
  writeSessionLogOffsets(offsets);
  logger.debug({ sessionId, count }, "Session log offset saved");
}
function formatTimestamp(date) {
  return date.toISOString().replace("T", " ").replace("Z", "");
}
class ConversationLogger {
  config;
  filePath;
  cwd;
  currentSessionId = null;
  lastExtractedMessageCount = 0;
  currentQueueLogPath = null;
  queueLogsDir;
  constructor(config) {
    this.config = config;
    this.filePath = resolve(process.cwd(), config.filePath);
    this.cwd = process.cwd();
    this.queueLogsDir = join(dirname$1(this.filePath), "queue-logs");
    this.currentSessionId = readSessionId(this.cwd);
    logger.debug({ cwd: this.cwd, sessionId: this.currentSessionId }, "ConversationLogger session ID loaded");
    if (config.enabled) {
      this.initLogFile();
      logger.info({ filePath: this.filePath }, "ConversationLogger initialized");
    }
  }
  /**
   * Initialize log file with header if it doesn't exist
   */
  initLogFile() {
    if (!existsSync$1(this.filePath)) {
      const header = `# Qlaude Conversation Log
# Started: ${(/* @__PURE__ */ new Date()).toISOString()}
${"=".repeat(90)}

`;
      try {
        const dir = dirname$1(this.filePath);
        if (!existsSync$1(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        writeFileSync(this.filePath, header, "utf-8");
      } catch (err) {
        logger.error({ err, filePath: this.filePath }, "Failed to create conversation log file");
      }
    }
  }
  /**
   * Check if logging is enabled
   */
  isEnabled() {
    return this.config.enabled;
  }
  /**
   * Log queue execution started
   * Reads session ID from hook-provided file
   * Creates a new queue-specific log file
   */
  logQueueStarted() {
    if (!this.config.enabled) return;
    this.lastExtractedMessageCount = 0;
    this.currentSessionId = readSessionId(this.cwd);
    if (!existsSync$1(this.queueLogsDir)) {
      try {
        mkdirSync(this.queueLogsDir, { recursive: true });
      } catch (err) {
        logger.error({ err, dir: this.queueLogsDir }, "Failed to create queue logs directory");
      }
    }
    const timestamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    this.currentQueueLogPath = join(this.queueLogsDir, `queue-${timestamp}.log`);
    const sessionId = this.currentSessionId;
    const sessionInfo = sessionId ? ` (${sessionId})` : "";
    const entry = `
${"═".repeat(90)}
[${formatTimestamp(/* @__PURE__ */ new Date())}] Queue execution started${sessionInfo}
${"═".repeat(90)}

`;
    try {
      writeFileSync(this.currentQueueLogPath, entry, "utf-8");
      logger.debug({ sessionId: this.currentSessionId, queueLog: this.currentQueueLogPath }, "ConversationLogger: queue started logged");
    } catch (err) {
      logger.error({ err }, "Failed to log queue started");
    }
  }
  /**
   * Log a queue item execution
   */
  logQueueItem(item) {
    if (!this.config.enabled || !this.currentQueueLogPath) return;
    let itemDesc;
    if (item.isBreakpoint) {
      itemDesc = item.prompt ? `>># ${item.prompt}` : ">>#";
    } else if (item.labelSession) {
      itemDesc = `>>{Label:${item.labelSession}}`;
    } else if (item.loadSessionLabel) {
      itemDesc = item.prompt ? `>>>{Load:${item.loadSessionLabel}} ${item.prompt}` : `>>>{Load:${item.loadSessionLabel}}`;
    } else if (item.isMultiline) {
      const prefix = item.isNewSession ? ">>>(" : ">>(";
      itemDesc = `${prefix}...>>)`;
    } else if (item.isNewSession) {
      itemDesc = item.prompt ? `>>> ${item.prompt}` : ">>>";
    } else {
      itemDesc = `>> ${item.prompt}`;
    }
    const entry = `[${formatTimestamp(/* @__PURE__ */ new Date())}] Queue: ${itemDesc}
`;
    let fullEntry = entry;
    if (item.isMultiline && item.prompt) {
      fullEntry += `${item.prompt}
${"─".repeat(40)}
`;
    }
    try {
      appendFileSync(this.currentQueueLogPath, fullEntry, "utf-8");
      logger.debug({ item: itemDesc }, "ConversationLogger: queue item logged");
    } catch (err) {
      logger.error({ err }, "Failed to log queue item");
    }
  }
  /**
   * Log new session starting (extract current session first)
   * @param item Optional queue item to show what session is being loaded
   */
  logNewSessionStarting(item) {
    if (!this.config.enabled || !this.currentQueueLogPath) return;
    this.extractAndLogCurrentSession();
    let sessionInfo = "";
    if (item?.loadSessionLabel && item?.resumeSessionId) {
      sessionInfo = ` → Loading "${item.loadSessionLabel}" (${item.resumeSessionId.slice(0, 8)}...)`;
    } else if (item?.loadSessionLabel) {
      sessionInfo = ` → Loading "${item.loadSessionLabel}"`;
    } else if (item?.resumeSessionId) {
      sessionInfo = ` → Resuming ${item.resumeSessionId.slice(0, 8)}...`;
    }
    const entry = `
${"─".repeat(90)}
[${formatTimestamp(/* @__PURE__ */ new Date())}] New session starting${sessionInfo}
${"─".repeat(90)}

`;
    try {
      appendFileSync(this.currentQueueLogPath, entry, "utf-8");
      logger.debug("ConversationLogger: new session logged");
    } catch (err) {
      logger.error({ err }, "Failed to log new session");
    }
    this.currentSessionId = null;
    this.lastExtractedMessageCount = 0;
  }
  /**
   * Log queue execution completed (extract final session)
   */
  logQueueCompleted() {
    if (!this.config.enabled || !this.currentQueueLogPath) return;
    this.refreshSessionId();
    this.extractAndLogCurrentSession();
    const entry = `
${"═".repeat(90)}
[${formatTimestamp(/* @__PURE__ */ new Date())}] Queue execution completed
${"═".repeat(90)}

`;
    try {
      appendFileSync(this.currentQueueLogPath, entry, "utf-8");
      logger.debug({ queueLog: this.currentQueueLogPath }, "ConversationLogger: queue completed logged");
    } catch (err) {
      logger.error({ err }, "Failed to log queue completed");
    }
    this.currentQueueLogPath = null;
    try {
      deleteSessionId(this.cwd);
    } catch {
    }
  }
  /**
   * Extract conversations from current session and append to queue log
   */
  extractAndLogCurrentSession() {
    if (!this.currentQueueLogPath) return;
    if (!this.currentSessionId) {
      this.refreshSessionId();
    }
    if (!this.currentSessionId) {
      logger.warn("No session ID available, skipping extraction");
      return;
    }
    logger.debug(
      { currentSessionId: this.currentSessionId, lastCount: this.lastExtractedMessageCount },
      "extractAndLogCurrentSession called"
    );
    const sessionPath = getSessionFilePath(this.cwd, this.currentSessionId);
    if (!sessionPath) {
      logger.warn({ sessionId: this.currentSessionId }, "Session file not found");
      return;
    }
    try {
      const conversations = extractConversations(sessionPath);
      logger.debug(
        { total: conversations.length, lastCount: this.lastExtractedMessageCount, sessionId: this.currentSessionId },
        "Conversations extracted from JSONL"
      );
      const newConversations = conversations.slice(this.lastExtractedMessageCount);
      if (newConversations.length === 0) {
        logger.debug("No new conversations to extract");
        this.lastExtractedMessageCount = conversations.length;
        return;
      }
      const formatted = formatConversationsForLog(newConversations, this.config.timestamps);
      if (formatted) {
        appendFileSync(this.currentQueueLogPath, formatted, "utf-8");
        logger.info(
          { count: newConversations.length, sessionId: this.currentSessionId },
          "Conversations extracted and logged"
        );
      }
      this.lastExtractedMessageCount = conversations.length;
      saveSessionLogOffset(this.currentSessionId, conversations.length);
    } catch (err) {
      logger.error({ err, sessionId: this.currentSessionId }, "Failed to extract conversations");
    }
  }
  /**
   * Refresh session ID from hook-provided file
   * Call this when session might have changed
   */
  refreshSessionId() {
    const sessionId = readSessionId(this.cwd);
    if (sessionId && sessionId !== this.currentSessionId) {
      logger.info({ oldId: this.currentSessionId, newId: sessionId }, "Session ID updated from hook");
      this.currentSessionId = sessionId;
      this.lastExtractedMessageCount = getSessionLogOffset(sessionId);
      logger.debug({ sessionId, offset: this.lastExtractedMessageCount }, "Loaded persistent log offset");
    }
  }
  /**
   * Set session ID directly (for testing or manual override)
   */
  setSessionId(sessionId) {
    if (!this.config.enabled) return;
    this.currentSessionId = sessionId;
    this.lastExtractedMessageCount = 0;
    logger.debug({ sessionId }, "Session ID set manually");
  }
  /**
   * Get the cumulative log file path (legacy)
   */
  getFilePath() {
    return this.filePath;
  }
  /**
   * Get the current queue-specific log file path
   * Returns null if no queue is currently being executed
   */
  getCurrentQueueLogPath() {
    return this.currentQueueLogPath;
  }
  /**
   * Get the latest queue log file path
   * Returns current queue log if executing, otherwise finds most recent log file
   */
  getLatestQueueLogPath() {
    if (this.currentQueueLogPath && existsSync$1(this.currentQueueLogPath)) {
      return this.currentQueueLogPath;
    }
    if (!existsSync$1(this.queueLogsDir)) return null;
    const files = readdirSync(this.queueLogsDir).filter((f) => f.startsWith("queue-") && f.endsWith(".log")).sort().reverse();
    return files.length > 0 ? join(this.queueLogsDir, files[0]) : null;
  }
  /**
   * Get the current session ID
   */
  getCurrentSessionId() {
    return this.currentSessionId;
  }
}
const messages = {
  // Notification titles
  "notify.selection_prompt": "Input Required",
  "notify.interrupted": "Interrupted",
  "notify.breakpoint": "Breakpoint Reached",
  "notify.queue_started": "Queue Started",
  "notify.queue_completed": "Queue Completed",
  "notify.task_failed": "Task Failed",
  "notify.pty_crashed": "Claude Code Crash Recovery",
  // Queue info
  "queue.label": "Queue",
  "queue.items": "{count} items",
  // Buttons
  "button.cancel": "⬅️ Cancel",
  // Command responses
  "cmd.paused": "⏸️ Queue paused",
  "cmd.resumed": "▶️ Queue resumed",
  "cmd.paused_broadcast": "⏸️ Queue paused ({instanceId})",
  "cmd.resumed_broadcast": "▶️ Queue resumed ({instanceId})",
  "cmd.instance_required": "⚠️ Please specify instance ID\nExample: /{cmd} {instanceId}",
  "cmd.send_usage": "Usage: /send text or /send instanceId text",
  "cmd.key_usage": "Usage: /key text (input without Enter)",
  "cmd.sent": '📤 Sent: "{text}"',
  "cmd.sent_instance": '📤 Sent ({instanceId}): "{text}"',
  "cmd.key_sent": '⌨️ Input: "{text}"',
  "cmd.key_sent_instance": '⌨️ Input ({instanceId}): "{text}"',
  // Text input flow
  "textinput.callback": "✏️ #{n} - text input",
  "textinput.prompt": "✏️ #{n} selected\n\nPlease *reply* to this message with the text to send:",
  "textinput.placeholder": "Enter text...",
  "textinput.confirmed": '✅ #{n} selected + "{text}" sent',
  // Direct reply
  "reply.sent": '📤 "{text}" sent',
  // Status report
  "status.header": "📊 qlaude Status",
  "status.pty_running": "✅ Running",
  "status.pty_stopped": "❌ Stopped",
  "status.pty": "PTY: {status}",
  "status.state": "State: {state}",
  "status.autoexec_paused": "⏸️ Paused",
  "status.autoexec_active": "▶️ Active",
  "status.autoexec": "Auto-exec: {status}",
  // Log request
  "log.queue_caption": "📋 Queue log ({instanceId})",
  "log.session_caption": "💬 Session log",
  "log.none": "📭 No logs to send",
  "log.sent": "✅ {count} logs sent",
  // Display request
  "display.empty": "📭 Screen buffer is empty"
};
let userOverrides = {};
function t(key, params) {
  let msg = userOverrides[key] ?? messages[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replaceAll(`{${k}}`, String(v));
    }
  }
  return msg;
}
class TelegramNotifier extends EventEmitter {
  config;
  projectName;
  hostname;
  ipAddress;
  instanceId;
  pollingActive = false;
  pollingInterval = null;
  // Multi-instance polling: delayed offset confirmation
  confirmedOffset = 0;
  processedUpdateIds = /* @__PURE__ */ new Set();
  updateFirstSeen = /* @__PURE__ */ new Map();
  confirmDelayMs;
  static STALE_MESSAGE_THRESHOLD_S = 120;
  static MAX_PROCESSED_IDS = 5e3;
  lastNotifiedType = null;
  lastNotifiedTime = 0;
  static NOTIFICATION_COOLDOWN_MS = 1e3;
  // 1 second cooldown for same type
  // Stabilization delay for selection_prompt to wait for all options to render
  pendingSelectionNotification = null;
  static SELECTION_STABILIZATION_MS = 800;
  // Wait for options to stabilize
  // Pending text input state (waiting for user reply after clicking text input button)
  pendingTextInput = null;
  // Last notification message ID (for direct reply support)
  lastNotificationMessageId = null;
  // User-defined layout templates from config
  templates;
  constructor(config) {
    super();
    this.config = config;
    this.confirmDelayMs = config.confirmDelayMs ?? 3e4;
    this.templates = config.templates ?? {};
    this.projectName = path.basename(process.cwd());
    this.hostname = os.hostname();
    this.ipAddress = this.getLocalIpAddress();
    this.instanceId = `${this.hostname}:${process.pid}`;
  }
  /**
   * Build Telegram API URL for a given method.
   * Centralizes URL construction to keep the bot token contained.
   */
  apiUrl(method) {
    return `https://api.telegram.org/bot${this.config.botToken}/${method}`;
  }
  emit(event, ...args) {
    return super.emit(event, ...args);
  }
  on(event, listener) {
    return super.on(event, listener);
  }
  /**
   * Get local IP address (first non-internal IPv4)
   */
  getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const netInterface = interfaces[name];
      if (!netInterface) continue;
      for (const info of netInterface) {
        if (!info.internal && info.family === "IPv4") {
          return info.address;
        }
      }
    }
    return "unknown";
  }
  /**
   * Get the unique instance ID
   */
  getInstanceId() {
    return this.instanceId;
  }
  /**
   * Check if notifications are enabled and configured
   */
  isEnabled() {
    return this.config.enabled && !!this.config.botToken && !!this.config.chatId;
  }
  /**
   * Start polling for callback queries
   */
  startPolling() {
    if (!this.isEnabled() || this.pollingActive) {
      return;
    }
    this.pollingActive = true;
    logger.info({ instanceId: this.instanceId }, "Telegram polling started");
    const poll = async () => {
      if (!this.pollingActive) return;
      try {
        await this.pollUpdates();
      } catch (err) {
        logger.warn({ err }, "Telegram polling error");
      }
      if (this.pollingActive) {
        this.pollingInterval = setTimeout(poll, 2e3);
      }
    };
    poll();
  }
  /**
   * Stop polling for callback queries
   */
  stopPolling() {
    this.pollingActive = false;
    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.pendingSelectionNotification) {
      clearTimeout(this.pendingSelectionNotification.timer);
      this.pendingSelectionNotification = null;
    }
    logger.info("Telegram polling stopped");
  }
  /**
   * Poll for updates from Telegram.
   * Uses delayed offset confirmation so multiple instances sharing the same
   * bot token can each see every update within the confirmation window.
   */
  async pollUpdates() {
    if (!this.isEnabled()) return;
    const url = this.apiUrl("getUpdates");
    const now = Date.now();
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offset: this.confirmedOffset + 1,
          timeout: 1,
          allowed_updates: ["callback_query", "message"]
        })
      });
      if (!response.ok) {
        return;
      }
      const data = await response.json();
      if (!data.ok || !data.result) {
        return;
      }
      for (const update of data.result) {
        if (!this.updateFirstSeen.has(update.update_id)) {
          this.updateFirstSeen.set(update.update_id, now);
        }
        if (this.processedUpdateIds.has(update.update_id)) {
          continue;
        }
        this.processedUpdateIds.add(update.update_id);
        if (update.callback_query) {
          await this.handleCallback(update.callback_query);
        }
        if (update.message) {
          await this.handleMessage(update.message);
        }
      }
      this.advanceConfirmedOffset(now);
      this.cleanupProcessedUpdates();
    } catch {
    }
  }
  /**
   * Advance confirmedOffset for updates older than confirmDelayMs.
   * Only advances sequentially — stops at the first update that is not old enough,
   * because offset confirmation is sequential (confirming N deletes all < N).
   */
  advanceConfirmedOffset(now) {
    const trackedIds = [...this.updateFirstSeen.keys()].sort((a, b) => a - b);
    let newOffset = this.confirmedOffset;
    for (const updateId of trackedIds) {
      if (updateId <= this.confirmedOffset) continue;
      const firstSeen = this.updateFirstSeen.get(updateId);
      if (now - firstSeen >= this.confirmDelayMs) {
        newOffset = updateId;
      } else {
        break;
      }
    }
    if (newOffset > this.confirmedOffset) {
      this.confirmedOffset = newOffset;
      logger.debug({ confirmedOffset: this.confirmedOffset }, "Telegram offset advanced");
    }
  }
  /**
   * Remove tracking entries for confirmed updates to bound memory usage.
   */
  cleanupProcessedUpdates() {
    for (const updateId of this.updateFirstSeen.keys()) {
      if (updateId <= this.confirmedOffset) {
        this.updateFirstSeen.delete(updateId);
        this.processedUpdateIds.delete(updateId);
      }
    }
    if (this.processedUpdateIds.size > TelegramNotifier.MAX_PROCESSED_IDS) {
      const sorted = [...this.processedUpdateIds].sort((a, b) => a - b);
      const toRemove = sorted.slice(0, sorted.length - TelegramNotifier.MAX_PROCESSED_IDS);
      for (const id of toRemove) {
        this.processedUpdateIds.delete(id);
        this.updateFirstSeen.delete(id);
      }
      logger.warn(
        { removed: toRemove.length, remaining: this.processedUpdateIds.size },
        "Trimmed processedUpdateIds due to size cap"
      );
    }
  }
  /**
   * Handle a text message (commands like /pause, /resume, /status, /send)
   * Commands can target specific instances: /pause HOSTNAME:PID
   * Also handles replies for text input flow
   */
  async handleMessage(message) {
    if (!message.text) return;
    if (String(message.chat.id) !== this.config.chatId) {
      return;
    }
    const messageAge = Math.floor(Date.now() / 1e3) - message.date;
    if (messageAge > TelegramNotifier.STALE_MESSAGE_THRESHOLD_S) {
      logger.debug({ messageAge, threshold: TelegramNotifier.STALE_MESSAGE_THRESHOLD_S }, "Skipping stale Telegram message");
      return;
    }
    const text = message.text.trim();
    if (message.reply_to_message && this.pendingTextInput) {
      if (message.reply_to_message.message_id === this.pendingTextInput.messageId) {
        const optionNumber = this.pendingTextInput.optionNumber;
        this.pendingTextInput = null;
        logger.info({ optionNumber, text }, "Telegram text input received");
        this.emit("text_input", optionNumber, text);
        const truncatedText = text.length > 20 ? text.slice(0, 20) + "..." : text;
        await this.replyToMessage(
          message.chat.id,
          message.message_id,
          t("textinput.confirmed", { n: optionNumber, text: truncatedText })
        );
        return;
      }
    }
    if (message.reply_to_message && this.lastNotificationMessageId) {
      if (message.reply_to_message.message_id === this.lastNotificationMessageId) {
        logger.info({ text }, "Telegram direct reply to notification");
        this.emit("send_text", text);
        const truncatedReply = text.length > 20 ? text.slice(0, 20) + "..." : text;
        await this.replyToMessage(
          message.chat.id,
          message.message_id,
          t("reply.sent", { text: truncatedReply })
        );
        return;
      }
    }
    const commandMatch = text.match(/^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/i);
    if (!commandMatch) return;
    const [, cmd, args] = commandMatch;
    const cmdLower = cmd.toLowerCase();
    if (cmdLower === "send") {
      await this.handleSendCommand(message, args);
      return;
    }
    if (cmdLower === "key") {
      await this.handleKeyCommand(message, args);
      return;
    }
    const targetInstanceId = args?.trim();
    if (targetInstanceId && targetInstanceId !== this.instanceId) {
      logger.debug(
        { targetInstanceId, myInstanceId: this.instanceId },
        "Ignoring command for different instance"
      );
      return;
    }
    const isBroadcast = !targetInstanceId;
    switch (cmdLower) {
      case "pause":
        logger.info({ instanceId: this.instanceId, broadcast: isBroadcast }, "Telegram /pause command received");
        this.emit("command", "pause");
        await this.replyToMessage(
          message.chat.id,
          message.message_id,
          isBroadcast ? t("cmd.paused_broadcast", { instanceId: this.instanceId }) : t("cmd.paused")
        );
        break;
      case "resume":
        logger.info({ instanceId: this.instanceId, broadcast: isBroadcast }, "Telegram /resume command received");
        this.emit("command", "resume");
        await this.replyToMessage(
          message.chat.id,
          message.message_id,
          isBroadcast ? t("cmd.resumed_broadcast", { instanceId: this.instanceId }) : t("cmd.resumed")
        );
        break;
      case "status":
        logger.info({ instanceId: this.instanceId, broadcast: isBroadcast }, "Telegram /status command received");
        this.emit("status_request", message.chat.id, message.message_id);
        break;
      case "log":
        logger.info({ instanceId: this.instanceId, broadcast: isBroadcast }, "Telegram /log command received");
        this.emit("log_request", message.chat.id, message.message_id);
        break;
      case "display":
        logger.info({ instanceId: this.instanceId, broadcast: isBroadcast }, "Telegram /display command received");
        this.emit("display_request", message.chat.id, message.message_id);
        break;
    }
  }
  /**
   * Shared handler for /send and /key commands.
   * Both commands parse an optional instance ID prefix and emit a text event.
   */
  async handleInputCommand(message, args, config) {
    if (!args || args.trim().length === 0) {
      await this.replyToMessage(message.chat.id, message.message_id, t(config.usageKey));
      return;
    }
    const trimmedArgs = args.trim();
    const parts = trimmedArgs.split(/\s+/);
    if (parts.length >= 2 && parts[0].includes(":")) {
      const potentialInstanceId = parts[0];
      if (potentialInstanceId !== this.instanceId) {
        logger.debug(
          { targetInstanceId: potentialInstanceId, myInstanceId: this.instanceId },
          `Ignoring ${config.logLabel} for different instance`
        );
        return;
      }
      const textToSend = parts.slice(1).join(" ");
      logger.info({ text: textToSend }, `Telegram ${config.logLabel} command received`);
      this.emit(config.event, textToSend);
      await this.replyToMessage(
        message.chat.id,
        message.message_id,
        t(config.sentKey, { text: textToSend.length > 30 ? textToSend.slice(0, 30) + "..." : textToSend })
      );
    } else {
      logger.info({ text: trimmedArgs }, `Telegram ${config.logLabel} command received`);
      this.emit(config.event, trimmedArgs);
      await this.replyToMessage(
        message.chat.id,
        message.message_id,
        t(config.sentInstanceKey, {
          instanceId: this.instanceId,
          text: trimmedArgs.length > 30 ? trimmedArgs.slice(0, 30) + "..." : trimmedArgs
        })
      );
    }
  }
  /**
   * Handle /send command: /send text or /send instanceId text (with Enter)
   */
  async handleSendCommand(message, args) {
    return this.handleInputCommand(message, args, {
      event: "send_text",
      usageKey: "cmd.send_usage",
      sentKey: "cmd.sent",
      sentInstanceKey: "cmd.sent_instance",
      logLabel: "/send"
    });
  }
  /**
   * Handle /key command: /key text or /key instanceId text (without Enter)
   */
  async handleKeyCommand(message, args) {
    return this.handleInputCommand(message, args, {
      event: "key_input",
      usageKey: "cmd.key_usage",
      sentKey: "cmd.key_sent",
      sentInstanceKey: "cmd.key_sent_instance",
      logLabel: "/key"
    });
  }
  /**
   * Reply to a message (public for external use)
   */
  async replyToChat(chatId, messageId, text) {
    await this.replyToMessage(chatId, messageId, text);
  }
  /**
   * Reply to a message
   */
  async replyToMessage(chatId, messageId, text) {
    const url = this.apiUrl("sendMessage");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          reply_to_message_id: messageId,
          text
        })
      });
      if (!response.ok) {
        logger.warn({ status: response.status, textLength: text.length }, "Telegram reply failed");
      } else {
        logger.debug({ chatId, messageId, textLength: text.length }, "Telegram reply sent");
      }
    } catch (error) {
      logger.warn({ error }, "Telegram reply request failed");
    }
  }
  /**
   * Send a plain text message (for status responses)
   */
  async sendPlainMessage(text) {
    if (!this.isEnabled()) return;
    const url = this.apiUrl("sendMessage");
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text
        })
      });
    } catch (error) {
      logger.warn({ error }, "Failed to send plain message");
    }
  }
  /**
   * Send a document file via Telegram
   * @param chatId Target chat ID
   * @param messageId Message ID to reply to
   * @param filePath Path to the file to send
   * @param caption Optional caption for the file
   */
  async sendDocument(chatId, messageId, filePath, caption) {
    if (!this.isEnabled()) return false;
    const url = this.apiUrl("sendDocument");
    try {
      const fs2 = await import("fs");
      const pathModule = await import("path");
      if (!fs2.existsSync(filePath)) {
        logger.warn({ filePath }, "File not found for sendDocument");
        return false;
      }
      const fileContent = fs2.readFileSync(filePath);
      const fileName = pathModule.basename(filePath);
      const formData = new FormData();
      formData.append("chat_id", String(chatId));
      formData.append("reply_to_message_id", String(messageId));
      formData.append("document", new Blob([fileContent]), fileName);
      if (caption) {
        formData.append("caption", caption);
      }
      const response = await fetch(url, {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, "Failed to send document");
        return false;
      }
      return true;
    } catch (error) {
      logger.warn({ error, filePath }, "Failed to send document");
      return false;
    }
  }
  /**
   * Handle a callback query from inline keyboard
   */
  async handleCallback(query) {
    if (!query.data) return;
    if (!query.message || String(query.message.chat.id) !== this.config.chatId) {
      return;
    }
    const colonIndex = query.data.indexOf(":");
    if (colonIndex === -1) return;
    const cmd = query.data.slice(0, colonIndex);
    const targetInstanceId = query.data.slice(colonIndex + 1);
    if (targetInstanceId !== this.instanceId) {
      logger.debug({ targetInstanceId, myInstanceId: this.instanceId }, "Ignoring callback for different instance");
      return;
    }
    const textInputMatch = cmd.match(/^textinput(\d+)$/);
    if (textInputMatch) {
      const optionNumber = parseInt(textInputMatch[1], 10);
      await this.answerCallback(query.id, t("textinput.callback", { n: optionNumber }));
      const forceReplyMessageId = await this.sendForceReplyMessage(
        query.message.chat.id,
        t("textinput.prompt", { n: optionNumber })
      );
      if (forceReplyMessageId) {
        this.pendingTextInput = {
          optionNumber,
          messageId: forceReplyMessageId
        };
        logger.info({ optionNumber }, "Text input requested, waiting for reply");
      }
      await this.editMessageButtons(query.message.chat.id, query.message.message_id, `textinput${optionNumber}`);
      return;
    }
    await this.answerCallback(query.id, `✓ ${cmd}`);
    this.resetNotificationDebounce();
    const command = cmd;
    logger.info({ command, instanceId: this.instanceId }, "Telegram command received");
    this.emit("command", command);
    await this.editMessageButtons(query.message.chat.id, query.message.message_id, cmd);
  }
  /**
   * Send a message with ForceReply to prompt user text input
   * Returns the message ID of the sent message
   */
  async sendForceReplyMessage(chatId, text) {
    const url = this.apiUrl("sendMessage");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "Markdown",
          reply_markup: {
            force_reply: true,
            selective: true,
            input_field_placeholder: t("textinput.placeholder")
          }
        })
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, "Failed to send ForceReply message");
        return null;
      }
      const data = await response.json();
      return data.result?.message_id ?? null;
    } catch (error) {
      logger.warn({ error }, "Failed to send ForceReply message");
      return null;
    }
  }
  /**
   * Answer a callback query
   */
  async answerCallback(callbackId, text) {
    const url = this.apiUrl("answerCallbackQuery");
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text
        })
      });
    } catch {
    }
  }
  /**
   * Edit message to show which button was pressed
   */
  async editMessageButtons(chatId, messageId, selectedCmd) {
    const url = this.apiUrl("editMessageReplyMarkup");
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[{ text: `✓ ${selectedCmd}`, callback_data: "done" }]]
          }
        })
      });
    } catch {
    }
  }
  /**
   * Send a notification with optional inline keyboard
   * Includes debounce to prevent duplicate notifications for same state
   * selection_prompt uses stabilization delay to wait for all options to render
   */
  async notify(type, details) {
    if (!this.isEnabled()) {
      return;
    }
    if (type === "selection_prompt") {
      if (this.pendingSelectionNotification) {
        clearTimeout(this.pendingSelectionNotification.timer);
        this.pendingSelectionNotification = null;
      }
      this.pendingSelectionNotification = {
        timer: setTimeout(async () => {
          this.pendingSelectionNotification = null;
          await this.sendSelectionNotification(details);
        }, TelegramNotifier.SELECTION_STABILIZATION_MS),
        details
      };
      logger.debug({ optionCount: details?.options?.length }, "Selection notification scheduled (stabilization delay)");
      return;
    }
    const now = Date.now();
    if (type === this.lastNotifiedType && now - this.lastNotifiedTime < TelegramNotifier.NOTIFICATION_COOLDOWN_MS) {
      logger.debug({ type, cooldownMs: TelegramNotifier.NOTIFICATION_COOLDOWN_MS }, "Notification debounced");
      return;
    }
    this.lastNotifiedType = type;
    this.lastNotifiedTime = now;
    const message = this.formatMessage(type, details);
    const keyboard = this.getKeyboardForType(type, details?.options);
    await this.sendMessage(message, keyboard);
  }
  /**
   * Send selection notification after stabilization delay
   */
  async sendSelectionNotification(details) {
    const now = Date.now();
    if (this.lastNotifiedType === "selection_prompt" && now - this.lastNotifiedTime < TelegramNotifier.NOTIFICATION_COOLDOWN_MS) {
      logger.debug("Selection notification debounced");
      return;
    }
    this.lastNotifiedType = "selection_prompt";
    this.lastNotifiedTime = now;
    const message = this.formatMessage("selection_prompt", details);
    const keyboard = this.getKeyboardForType("selection_prompt", details?.options);
    await this.sendMessage(message, keyboard);
    logger.debug({ optionCount: details?.options?.length }, "Selection notification sent");
  }
  /**
   * Reset notification debounce (call after user interaction)
   */
  resetNotificationDebounce() {
    this.lastNotifiedType = null;
    this.lastNotifiedTime = 0;
  }
  /**
   * Get inline keyboard buttons based on notification type
   * Only immediate actions related to the specific notification
   * @param options Parsed options for selection prompts
   */
  getKeyboardForType(type, options) {
    switch (type) {
      case "selection_prompt": {
        const count = Math.min(options?.length || 4, 16);
        const rows = [];
        const allButtons = [];
        for (let i = 1; i <= count; i++) {
          const opt = options?.find((o) => o.number === i);
          const isTextInput = opt?.isTextInput ?? false;
          allButtons.push({
            text: isTextInput ? `${i}✏️` : `${i}`,
            callback_data: isTextInput ? `textinput${i}:${this.instanceId}` : `select${i}:${this.instanceId}`
          });
        }
        if (allButtons.length > 0) {
          rows.push(allButtons.slice(0, 8));
        }
        if (allButtons.length > 8) {
          rows.push(allButtons.slice(8, 16));
        }
        rows.push([
          { text: t("button.cancel"), callback_data: `escape:${this.instanceId}` }
        ]);
        return rows;
      }
      case "breakpoint":
      case "task_failed":
        return [
          [
            { text: "▶️ Resume", callback_data: `resume:${this.instanceId}` }
          ]
        ];
      default:
        return null;
    }
  }
  /**
   * Render a template string by replacing {variable} placeholders.
   * Lines that become empty after substitution are removed.
   */
  renderTemplate(template, vars) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(`{${key}}`, value);
    }
    return result.split("\n").filter((line) => line.trim().length > 0).join("\n");
  }
  /**
   * Build template variables for a notification message.
   * All values are raw data with MarkdownV2 escaping only (no decorative emojis/formatting).
   * Type-specific variables: breakpoint→{reason}, task_failed→{error}, pty_crashed→{recovery}.
   */
  buildTemplateVars(type, details) {
    const title = t(`notify.${type}`);
    let contextBlock = "";
    if (details?.context) {
      const cleanCtx = this.cleanContext(details.context);
      if (cleanCtx) {
        const escaped = cleanCtx.replace(/\\/g, "\\\\");
        contextBlock = `\`\`\`
${escaped}
\`\`\``;
      }
    }
    let optionsBlock = "";
    if (details?.options && details.options.length > 0) {
      optionsBlock = details.options.map((opt) => {
        const escapedText = this.escapeMarkdown(opt.text);
        const marker = opt.isTextInput ? " ✏️" : "";
        return `${opt.number}\\. ${escapedText}${marker}`;
      }).join("\n");
    }
    const vars = {
      // Common raw data variables
      title: this.escapeMarkdown(title),
      hostname: this.escapeMarkdown(this.hostname),
      ip: this.escapeMarkdown(this.ipAddress),
      instanceId: this.escapeMarkdown(this.instanceId),
      project: this.escapeMarkdown(this.projectName),
      queueLength: details?.queueLength !== void 0 ? String(details.queueLength) : "",
      // Type-specific raw data variables (only the relevant one is populated)
      reason: "",
      error: "",
      recovery: "",
      // Structural variables (pre-formatted)
      context: contextBlock,
      options: optionsBlock
    };
    const msg = details?.message ? this.escapeMarkdown(details.message) : "";
    if (type === "breakpoint") {
      vars.reason = msg;
    } else if (type === "task_failed") {
      vars.error = msg;
    } else if (type === "pty_crashed") {
      vars.recovery = msg;
    }
    return vars;
  }
  /**
   * Format notification message based on type.
   * Uses user-defined template if available, otherwise falls back to default layout.
   */
  formatMessage(type, details) {
    const vars = this.buildTemplateVars(type, details);
    const template = this.templates[type] ?? this.templates["default"];
    if (template) {
      return this.renderTemplate(template, vars);
    }
    if (type === "selection_prompt") {
      const lines2 = [
        `⚠️ *${vars.title}*  📁 ${vars.project}`
      ];
      if (vars.context) {
        lines2.push("", vars.context);
      }
      const footerParts = [`🆔 \`${vars.instanceId}\``];
      if (vars.queueLength) {
        const items = t("queue.items", { count: vars.queueLength });
        footerParts.push(`📋 ${items}`);
      }
      lines2.push("", footerParts.join(" · "));
      return lines2.join("\n");
    }
    const emojiMap = {
      selection_prompt: "⚠️",
      interrupted: "🛑",
      breakpoint: "⏸️",
      queue_started: "▶️",
      queue_completed: "✅",
      task_failed: "❌",
      pty_crashed: "💥"
    };
    const emoji = emojiMap[type];
    const lines = [
      `🤖 *[qlaude]* ${emoji} *${vars.title}*`,
      "",
      `🖥️ ${vars.hostname} \\(${vars.ip}\\)`,
      `🆔 \`${vars.instanceId}\``,
      `📁 ${vars.project}`
    ];
    if (vars.queueLength) {
      const label = t("queue.label");
      const items = t("queue.items", { count: vars.queueLength });
      lines.push(`📋 ${label}: ${items}`);
    }
    const typeMsg = vars.reason || vars.error || vars.recovery;
    if (typeMsg) {
      lines.push(`💬 ${typeMsg}`);
    }
    if (vars.context) {
      lines.push("", vars.context);
    }
    if (vars.options) {
      lines.push("", vars.options);
    }
    return lines.join("\n");
  }
  /**
   * Clean up context string: remove ANSI codes, UI chrome, and excessive whitespace
   */
  cleanContext(context) {
    const filterPatterns = [
      /^[─━═╌╍┄┅┈┉\-_╯╮╰╭╗╝╚╔┐┘└┌┤├┬┴┼]{5,}$/,
      // Horizontal lines and box-drawing borders (5+ chars)
      /Enter to select/i,
      /↑\/↓ to navigate/i,
      /←\/→ or tab to cycle/i,
      /Esc to cancel/i,
      /ctrl\+\w+ to/i,
      /^\s*\(\d+\/\d+\)\s*$/
      // Pagination like (1/3)
    ];
    const cleaned = context.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\r/g, "").split("\n").map((line) => line.trimEnd()).filter((line) => {
      if (line.length === 0) return false;
      const trimmed = line.trim();
      return !filterPatterns.some((pattern) => pattern.test(trimmed));
    }).join("\n").trim();
    return cleaned;
  }
  /**
   * Escape special characters for Telegram MarkdownV2
   * Backslashes are converted to forward slashes for cleaner paths
   */
  escapeMarkdown(text) {
    return text.replace(/\\/g, "/").replace(/[_*[\]()~`>#+\-=|{}.!]/g, "\\$&");
  }
  /**
   * Send message via Telegram Bot API
   * Stores message_id for direct reply support
   */
  async sendMessage(text, keyboard) {
    const url = this.apiUrl("sendMessage");
    const body = {
      chat_id: this.config.chatId,
      text,
      parse_mode: "MarkdownV2"
    };
    if (keyboard) {
      body.reply_markup = {
        inline_keyboard: keyboard
      };
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        logger.warn({ status: response.status }, "Telegram API error");
      } else {
        const data = await response.json();
        if (data.result?.message_id) {
          this.lastNotificationMessageId = data.result.message_id;
        }
        logger.debug({ type: text.substring(0, 50) }, "Telegram notification sent");
      }
    } catch (error) {
      logger.warn({ error }, "Failed to send Telegram notification");
    }
  }
}
const { Terminal } = pkg;
class TerminalEmulator {
  term;
  constructor(cols = 80, rows = 30) {
    this.term = new Terminal({
      cols,
      rows,
      allowProposedApi: true
    });
    logger.debug({ cols, rows }, "TerminalEmulator initialized");
  }
  /**
   * Write PTY output data to the terminal emulator
   */
  write(data) {
    this.term.write(data);
  }
  /**
   * Get the current line where the cursor is positioned
   * @returns The text content of the current line, trimmed
   */
  getCurrentLine() {
    try {
      const buffer = this.term.buffer.active;
      if (!buffer) {
        logger.warn("Terminal buffer not available");
        return "";
      }
      const cursorY = buffer.cursorY;
      const line = buffer.getLine(cursorY);
      if (!line) {
        return "";
      }
      const text = line.translateToString(true);
      logger.trace({ cursorY, text }, "getCurrentLine");
      return text;
    } catch (err) {
      logger.error({ err }, "Error getting current line");
      return "";
    }
  }
  /**
   * Get the last N lines from the terminal viewport
   * @param n Number of lines to retrieve
   * @returns Array of line contents
   */
  getLastLines(n) {
    try {
      const buffer = this.term.buffer.active;
      if (!buffer) {
        logger.debug("getLastLines: buffer not available");
        return [];
      }
      const lines = [];
      const rows = this.term.rows;
      const baseY = buffer.baseY;
      for (let y = 0; y < rows; y++) {
        const line = buffer.getLine(baseY + y);
        if (line) {
          lines.push(line.translateToString(true));
        }
      }
      while (lines.length < n) {
        lines.unshift("");
      }
      return lines;
    } catch (err) {
      logger.error({ err }, "Error getting last lines");
      return [];
    }
  }
  /**
   * Get the cursor X position (column)
   */
  getCursorX() {
    try {
      return this.term.buffer.active?.cursorX ?? 0;
    } catch {
      return 0;
    }
  }
  /**
   * Get the cursor Y position (row)
   */
  getCursorY() {
    try {
      return this.term.buffer.active?.cursorY ?? 0;
    } catch {
      return 0;
    }
  }
  /**
   * Resize the terminal
   */
  resize(cols, rows) {
    this.term.resize(cols, rows);
    logger.debug({ cols, rows }, "TerminalEmulator resized");
  }
  /**
   * Clear the terminal (reset state)
   */
  clear() {
    this.term.reset();
  }
  /**
   * Dispose of the terminal instance
   */
  dispose() {
    this.term.dispose();
    logger.debug("TerminalEmulator disposed");
  }
}
function setupPtyLifecycle(ctx) {
  const {
    ptyWrapper,
    autoExecutor,
    conversationLogger,
    display,
    telegramNotifier,
    queueManager,
    cleanup,
    getClaudeArgs,
    onExit = (code) => process.exit(code)
  } = ctx;
  ptyWrapper.on("exit", async (exitCode) => {
    if (exitCode !== 0 && autoExecutor.hasPendingSessionLoad()) {
      logger.warn({ exitCode }, "PTY exited during session load, recovering...");
      await autoExecutor.handlePtyExitDuringSessionLoad();
      try {
        ptyWrapper.spawn(getClaudeArgs());
        logger.info("PTY restarted after session load failure");
      } catch (error) {
        logger.error({ error }, "Failed to restart PTY after session load failure");
        cleanup();
        onExit(1);
      }
      return;
    }
    if (exitCode !== 0 && autoExecutor.isQueueActive()) {
      const sessionId = conversationLogger.getCurrentSessionId();
      logger.warn({ exitCode, sessionId }, "PTY crashed during queue execution, attempting recovery");
      display.showMessage("warning", "[Queue] Claude Code crashed. Recovering...");
      const shouldRestart = await autoExecutor.handlePtyCrashRecovery();
      if (!shouldRestart) {
        try {
          ptyWrapper.spawn(getClaudeArgs());
          logger.info("PTY restarted in idle mode after max crash recoveries");
        } catch (error) {
          logger.error({ error }, "Failed to restart PTY after max crash recoveries");
          cleanup();
          process.exit(1);
        }
        return;
      }
      telegramNotifier.notify("pty_crashed", {
        queueLength: queueManager.getLength(),
        message: sessionId ? "Resuming session..." : "Restarting fresh..."
      });
      try {
        if (sessionId) {
          ptyWrapper.spawn(["--resume", sessionId, ...getClaudeArgs()]);
          logger.info({ sessionId }, "PTY restarted with --resume after crash");
        } else {
          ptyWrapper.spawn(getClaudeArgs());
          logger.info("PTY restarted fresh after crash (no session ID)");
        }
      } catch (error) {
        logger.error({ error }, "Failed to restart PTY after crash");
        cleanup();
        onExit(1);
      }
      return;
    }
    if (exitCode !== 0) {
      display.showMessage("error", getUserFriendlyMessage(ErrorCode.PTY_UNEXPECTED_EXIT));
    }
    cleanup();
    onExit(exitCode);
  });
}
function setupTelegramBridge(ctx) {
  const {
    telegramNotifier,
    ptyWrapper,
    autoExecutor,
    stateDetector,
    display,
    queueManager,
    conversationLogger,
    terminalEmulator,
    cwd = process.cwd()
  } = ctx;
  telegramNotifier.on("command", (cmd) => {
    logger.info({ cmd }, "Received Telegram command");
    const selectMatch = cmd.match(/^select(\d+)$/);
    if (selectMatch) {
      const num = selectMatch[1];
      ptyWrapper.write(num);
      display.showMessage("info", `[Telegram] Option ${num} selected`);
      return;
    }
    switch (cmd) {
      case "escape":
        ptyWrapper.write("\x1B");
        display.showMessage("info", "[Telegram] Selection cancelled");
        break;
      case "pause":
        autoExecutor.stop();
        display.setPaused(true);
        display.showMessage("warning", "[Telegram] Auto-execution paused");
        break;
      case "resume":
        autoExecutor.start();
        display.setPaused(false);
        display.showMessage("success", "[Telegram] Auto-execution resumed");
        stateDetector.forceReady();
        break;
    }
  });
  telegramNotifier.on("status_request", (chatId, messageId) => {
    logger.debug({ chatId, messageId }, "Handling status_request event");
    const queueLength = queueManager.getLength();
    const state = stateDetector.getState();
    const isPaused = !autoExecutor.isEnabled();
    const isRunning = ptyWrapper.isRunning();
    const ptyStatus = isRunning ? t("status.pty_running") : t("status.pty_stopped");
    const autoStatus = isPaused ? t("status.autoexec_paused") : t("status.autoexec_active");
    const lines = [
      t("status.header"),
      ``,
      `🖥️ ${telegramNotifier.getInstanceId()}`,
      `📁 ${path.basename(cwd)}`,
      ``,
      t("status.pty", { status: ptyStatus }),
      t("status.state", { state: state.type }),
      t("status.autoexec", { status: autoStatus }),
      `${t("queue.label")}: ${t("queue.items", { count: queueLength })}`
    ];
    telegramNotifier.replyToChat(chatId, messageId, lines.join("\n"));
  });
  telegramNotifier.on("log_request", async (chatId, messageId) => {
    const queueLogPath = conversationLogger.getLatestQueueLogPath();
    conversationLogger.refreshSessionId();
    const sessionId = conversationLogger.getCurrentSessionId();
    let sentCount = 0;
    if (queueLogPath && existsSync$1(queueLogPath)) {
      const sent = await telegramNotifier.sendDocument(
        chatId,
        messageId,
        queueLogPath,
        t("log.queue_caption", { instanceId: telegramNotifier.getInstanceId() })
      );
      if (sent) sentCount++;
    }
    if (sessionId) {
      const sessionPath = getSessionFilePath(cwd, sessionId);
      logger.debug({ sessionId, sessionPath }, "Session log path lookup");
      if (sessionPath && existsSync$1(sessionPath)) {
        try {
          const conversations = extractConversations(sessionPath);
          const formatted = formatConversationsForLog(conversations, true);
          logger.debug({ conversationCount: conversations.length, hasFormatted: !!formatted }, "Session log extracted");
          if (formatted) {
            const tempPath = path.join(tmpdir(), `session-${sessionId.slice(0, 8)}.log`);
            writeFileSync(tempPath, formatted, "utf-8");
            const sent = await telegramNotifier.sendDocument(
              chatId,
              messageId,
              tempPath,
              t("log.session_caption")
            );
            if (sent) sentCount++;
            try {
              unlinkSync(tempPath);
            } catch {
            }
          } else {
            logger.debug({ sessionId }, "Session log formatted content is empty");
          }
        } catch (err) {
          logger.error({ err, sessionId }, "Failed to extract session log");
        }
      } else {
        logger.debug({ sessionId, sessionPath, exists: sessionPath ? existsSync$1(sessionPath) : false }, "Session file not found");
      }
    } else {
      logger.debug("No session ID available for log extraction");
    }
    if (sentCount === 0) {
      telegramNotifier.replyToChat(chatId, messageId, t("log.none"));
    } else {
      telegramNotifier.replyToChat(chatId, messageId, t("log.sent", { count: sentCount }));
    }
  });
  telegramNotifier.on("display_request", (chatId, messageId) => {
    logger.debug({ chatId, messageId }, "Handling display_request event");
    const lines = terminalEmulator.getLastLines(25);
    const currentState = stateDetector.getState();
    const hostname$1 = hostname();
    if (lines.length === 0) {
      logger.debug("display_request: empty lines");
      telegramNotifier.replyToChat(chatId, messageId, t("display.empty"));
      return;
    }
    const content = lines.map((line) => line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")).join("\n").trim();
    if (!content) {
      logger.debug("display_request: empty content after ANSI cleanup");
      telegramNotifier.replyToChat(chatId, messageId, t("display.empty"));
      return;
    }
    const header = `🖥️ ${hostname$1} | State: ${currentState.type} | Lines: ${lines.length}`;
    const truncated = content.length > 3900 ? content.slice(-3900) + "\n...(truncated)" : content;
    const message = `${header}
\`\`\`
${truncated}
\`\`\``;
    logger.debug({ textLength: message.length }, "display_request: sending reply");
    telegramNotifier.replyToChat(chatId, messageId, message);
  });
  telegramNotifier.on("text_input", (optionNumber, text) => {
    logger.info({ optionNumber, text }, "Telegram text_input received");
    ptyWrapper.write(String(optionNumber));
    setTimeout(() => {
      ptyWrapper.write(text);
      setTimeout(() => {
        ptyWrapper.write("\r");
        display.showMessage("info", `[Telegram] #${optionNumber} + "${text.slice(0, 20)}${text.length > 20 ? "..." : ""}" sent`);
      }, 100);
    }, 150);
  });
  telegramNotifier.on("send_text", (text) => {
    logger.info({ text }, "Telegram send_text received");
    ptyWrapper.write(text);
    setTimeout(() => {
      ptyWrapper.write("\r");
      display.showMessage("info", `[Telegram] "${text.slice(0, 20)}${text.length > 20 ? "..." : ""}" sent`);
    }, 100);
  });
  telegramNotifier.on("key_input", (text) => {
    logger.info({ text }, "Telegram key_input received");
    ptyWrapper.write(text);
    display.showMessage("info", `[Telegram] ⌨️ "${text.slice(0, 20)}${text.length > 20 ? "..." : ""}" typed`);
  });
}
class ElectronDisplay extends EventEmitter {
  paused = false;
  currentItem = null;
  lastItems = [];
  enabled = true;
  showMessage(type, message) {
    this.emit("message", type, message);
  }
  updateStatusBar(items) {
    this.lastItems = items;
    this.emit("statusBar", items);
  }
  setPaused(paused) {
    this.paused = paused;
    this.emit("paused", paused);
  }
  setCurrentItem(item) {
    this.currentItem = item;
    this.emit("currentItem", item);
    this.updateStatusBar(this.lastItems);
  }
  toggle() {
    this.enabled = !this.enabled;
    return this.enabled;
  }
  clear() {
  }
  getHeight() {
    return 0;
  }
  // Expose state for IPC serialization
  getState() {
    return {
      paused: this.paused,
      currentItem: this.currentItem,
      items: this.lastItems,
      enabled: this.enabled
    };
  }
}
class EngineManager extends EventEmitter {
  constructor(workspacePath2, config) {
    super();
    this.workspacePath = workspacePath2;
    process.chdir(workspacePath2);
    ensureConfigDir();
    this.config = config ?? loadConfig();
    this.display = new ElectronDisplay();
    this.display.on("message", (type, message) => {
      this.emit("display_message", { type, message });
    });
    this.ptyWrapper = new PtyWrapper();
    this.stateDetector = new StateDetector({
      idleThresholdMs: this.config.idleThresholdMs,
      requiredStableChecks: this.config.requiredStableChecks,
      patterns: compilePatterns(this.config.patterns)
    });
    this.terminalEmulator = new TerminalEmulator(120, 40);
    const convLogConfig = { ...DEFAULT_CONVERSATION_LOG_CONFIG, ...this.config.conversationLog };
    this.conversationLogger = new ConversationLogger({
      ...convLogConfig,
      filePath: join(workspacePath2, QLAUDE_DIR, convLogConfig.filePath)
    });
    const telegramConfig = { ...DEFAULT_TELEGRAM_CONFIG, ...this.config.telegram };
    this.telegramNotifier = new TelegramNotifier(telegramConfig);
    this.queueManager = new QueueManager(join(workspacePath2, QLAUDE_DIR, "queue"));
    this.autoExecutor = new AutoExecutor(
      {
        stateDetector: this.stateDetector,
        queueManager: this.queueManager,
        ptyWrapper: this.ptyWrapper,
        display: this.display,
        getClaudeArgs: () => this.claudeArgs,
        conversationLogger: this.conversationLogger,
        terminalEmulator: this.terminalEmulator,
        telegramNotifier: this.telegramNotifier
      },
      { enabled: !this.config.startPaused }
    );
    this.setupEventForwarding();
  }
  ptyWrapper;
  stateDetector;
  autoExecutor;
  queueManager;
  display;
  terminalEmulator;
  conversationLogger;
  telegramNotifier;
  config;
  engineState = "idle";
  claudeArgs = [];
  disposed = false;
  setupEventForwarding() {
    this.ptyWrapper.on("data", (data) => {
      this.stateDetector.analyze(data);
      this.terminalEmulator.write(data);
      this.emit("pty_data", data);
    });
    this.stateDetector.on("state_change", (state) => {
      this.emit("state_change", { type: state.type, timestamp: Date.now() });
    });
    this.queueManager.on("item_added", () => {
      this.display.updateStatusBar(this.queueManager.getItems());
    });
    this.queueManager.on("item_removed", () => {
      this.display.updateStatusBar(this.queueManager.getItems());
    });
    this.queueManager.on("queue_reloaded", () => {
      this.display.updateStatusBar(this.queueManager.getItems());
    });
    this.queueManager.on("item_executed", () => {
      this.display.updateStatusBar(this.queueManager.getItems());
    });
    setupPtyLifecycle({
      ptyWrapper: this.ptyWrapper,
      autoExecutor: this.autoExecutor,
      conversationLogger: this.conversationLogger,
      display: this.display,
      telegramNotifier: this.telegramNotifier,
      queueManager: this.queueManager,
      cleanup: () => this.dispose(),
      getClaudeArgs: () => this.claudeArgs,
      onExit: (code) => {
        this.setEngineState("stopped");
        this.emit("engine_state", "stopped");
        if (code !== 0) {
          this.emit("error", new Error(`PTY exited with code ${code}`));
        }
      }
    });
    setupTelegramBridge({
      telegramNotifier: this.telegramNotifier,
      ptyWrapper: this.ptyWrapper,
      autoExecutor: this.autoExecutor,
      stateDetector: this.stateDetector,
      display: this.display,
      queueManager: this.queueManager,
      conversationLogger: this.conversationLogger,
      terminalEmulator: this.terminalEmulator,
      cwd: this.workspacePath
    });
  }
  async start(claudeArgs = []) {
    if (this.disposed) throw new Error("EngineManager is disposed");
    this.claudeArgs = claudeArgs;
    this.display.setPaused(this.config.startPaused ?? true);
    await this.queueManager.reload();
    this.display.updateStatusBar(this.queueManager.getItems());
    this.ptyWrapper.spawn(this.claudeArgs);
    this.setEngineState("running");
  }
  pause() {
    this.autoExecutor.stop();
    this.display.setPaused(true);
    this.setEngineState("paused");
  }
  resume() {
    this.autoExecutor.start();
    this.display.setPaused(false);
    this.stateDetector.forceReady();
    this.setEngineState("running");
  }
  stop() {
    if (this.ptyWrapper.isRunning()) {
      this.ptyWrapper.kill();
    }
    this.setEngineState("stopped");
  }
  writeTopty(data) {
    this.ptyWrapper.write(data);
  }
  getQueueManager() {
    return this.queueManager;
  }
  getEngineState() {
    return this.engineState;
  }
  async reloadQueue() {
    await this.queueManager.reload();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.ptyWrapper.isRunning()) {
      this.ptyWrapper.kill();
    }
    this.telegramNotifier.stopPolling();
    this.terminalEmulator.dispose();
    this.removeAllListeners();
  }
  setEngineState(state) {
    this.engineState = state;
    this.emit("engine_state", state);
  }
}
function taskToQueueLine(task) {
  if (task.is_new_session) return "@new";
  if (task.is_breakpoint) return task.prompt ? `@pause ${task.prompt}` : "@pause";
  if (task.label_session) return `@save ${task.label_session}`;
  if (task.load_session_label) return `@load ${task.load_session_label}`;
  if (task.model_name) return `@model ${task.model_name}`;
  if (task.delay_ms) return `@delay ${task.delay_ms}`;
  if (task.prompt) {
    if (task.prompt.includes("\n")) {
      return `@(
${task.prompt}
@)`;
    }
    return task.prompt;
  }
  return null;
}
class QueueSyncAdapter {
  constructor(workspacePath2, taskRepo2, queueManager) {
    this.taskRepo = taskRepo2;
    this.queueManager = queueManager;
    this.workspacePath = workspacePath2;
    this.queueFilePath = join(workspacePath2, ".qlaude", "queue");
  }
  workspacePath;
  queueFilePath;
  /**
   * Sync queued tasks from SQLite to the .qlaude/queue file and reload QueueManager
   */
  syncToEngine() {
    const queuedTasks = this.taskRepo.listQueued(this.workspacePath);
    const lines = queuedTasks.map(taskToQueueLine).filter((line) => line !== null);
    const content = lines.join("\n") + (lines.length > 0 ? "\n" : "");
    mkdirSync(join(this.workspacePath, ".qlaude"), { recursive: true });
    writeFileSync(this.queueFilePath, content, "utf-8");
    this.queueManager.reload().catch(() => {
    });
  }
  /**
   * Called when the engine starts executing a task
   */
  onItemStarted(executionId, taskId) {
    this.taskRepo.update(taskId, {
      status: "running",
      started_at: (/* @__PURE__ */ new Date()).toISOString(),
      execution_id: executionId
    });
  }
  /**
   * Called when the engine completes a task
   */
  onItemCompleted(taskId) {
    this.taskRepo.markCompleted(taskId);
  }
  /**
   * Called when the engine fails a task
   */
  onItemFailed(taskId, reason) {
    this.taskRepo.markFailed(taskId, reason);
  }
}
function registerIpcHandlers(deps) {
  const { getEngine, taskRepo: taskRepo2, settingsRepo: settingsRepo2, telegramRepo: telegramRepo2, queueSync, win: win2 } = deps;
  ipcMain.handle("health:check", () => ({
    ok: true,
    version: app.getVersion(),
    platform: process.platform
  }));
  ipcMain.handle("tasks:list", (_event, workspacePath2) => {
    return taskRepo2.listByWorkspace(workspacePath2);
  });
  ipcMain.handle("tasks:create", (_event, payload) => {
    const task = taskRepo2.create({
      workspace_path: payload.workspace_path,
      title: payload.title,
      prompt: payload.prompt,
      is_new_session: payload.is_new_session ? 1 : 0,
      model_name: payload.model_name ?? null,
      delay_ms: payload.delay_ms ?? null,
      is_breakpoint: payload.is_breakpoint ? 1 : 0,
      label_session: payload.label_session ?? null,
      load_session_label: payload.load_session_label ?? null
    });
    queueSync.syncToEngine();
    return task;
  });
  ipcMain.handle("tasks:update", (_event, id, fields) => {
    const task = taskRepo2.update(id, fields);
    queueSync.syncToEngine();
    return task;
  });
  ipcMain.handle("tasks:delete", (_event, id) => {
    const ok = taskRepo2.delete(id);
    queueSync.syncToEngine();
    return ok;
  });
  ipcMain.handle("tasks:reorder", (_event, id, newOrder) => {
    taskRepo2.reorder(id, newOrder);
    queueSync.syncToEngine();
    return true;
  });
  ipcMain.handle("queue:start", async (_event, workspacePath2) => {
    const engine2 = getEngine();
    if (!engine2) return { ok: false, error: "Engine not initialized" };
    await engine2.start([]);
    return { ok: true };
  });
  ipcMain.handle("queue:pause", () => {
    getEngine()?.pause();
    return { ok: true };
  });
  ipcMain.handle("queue:resume", () => {
    getEngine()?.resume();
    return { ok: true };
  });
  ipcMain.handle("queue:reload", async () => {
    await getEngine()?.reloadQueue();
    return { ok: true };
  });
  ipcMain.handle("workspace:open", async () => {
    const result = await dialog.showOpenDialog(win2, {
      properties: ["openDirectory"],
      title: "Select Workspace"
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const selectedPath = result.filePaths[0];
    deps.setWorkspacePath(selectedPath);
    return { path: selectedPath, name: basename(selectedPath) };
  });
  ipcMain.handle("workspace:get", () => {
    const path2 = deps.getWorkspacePath();
    return { path: path2, name: basename(path2) };
  });
  ipcMain.handle("telegram:validateToken", async (_event, token) => {
    try {
      const { validateBotToken } = await import("./setup-wizard-CzQbIVtu.js");
      return await validateBotToken(token);
    } catch {
      return null;
    }
  });
  ipcMain.handle("telegram:detectChatId", async (_event, token) => {
    try {
      const { detectChatId } = await import("./setup-wizard-CzQbIVtu.js");
      return await detectChatId(token);
    } catch {
      return null;
    }
  });
  ipcMain.handle("telegram:testConnection", async () => {
    const config = telegramRepo2.get();
    if (!config.bot_token || !config.chat_id) return { ok: false, error: "Not configured" };
    try {
      const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: config.chat_id, text: "✅ qlaude Desktop connected!" })
      });
      return { ok: res.ok };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
  ipcMain.handle("telegram:saveConfig", (_event, config) => {
    telegramRepo2.update({
      bot_token: config.botToken,
      chat_id: config.chatId,
      validated: true,
      enabled: true
    });
    return { ok: true };
  });
  ipcMain.handle("telegram:getStatus", () => {
    return telegramRepo2.get();
  });
  ipcMain.handle("onboarding:getStatus", () => {
    const completed = settingsRepo2.get("onboarding_completed");
    return { completed: completed === "true" };
  });
  ipcMain.handle("onboarding:complete", () => {
    settingsRepo2.set("onboarding_completed", "true");
    return { ok: true };
  });
  ipcMain.handle("logs:list", () => []);
  ipcMain.handle("logs:get", () => null);
}
function forwardEngineEvents(engine2, win2) {
  engine2.on("pty_data", (data) => {
    if (!win2.isDestroyed()) {
      win2.webContents.send("execution:data", data);
    }
  });
  engine2.on("state_change", (state) => {
    if (!win2.isDestroyed()) {
      win2.webContents.send("execution:state", state);
    }
  });
  engine2.on("task_status", (status) => {
    if (!win2.isDestroyed()) {
      win2.webContents.send("execution:taskStatus", status);
    }
  });
}
if (platform() !== "darwin") {
  console.error("qlaude Desktop requires macOS.");
  app.quit();
}
const dbPath = join(app.getPath("userData"), "qlaude.db");
const db = initDatabase(dbPath);
const taskRepo = new TaskRepository(db);
const settingsRepo = new SettingsRepository(db);
const telegramRepo = new TelegramRepository(db);
let workspacePath = homedir();
let engine = null;
let win;
function createQueueSync() {
  const queueManager = engine?.getQueueManager();
  if (!queueManager) throw new Error("Engine not initialized");
  return new QueueSyncAdapter(workspacePath, taskRepo, queueManager);
}
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    show: false,
    backgroundColor: "#1a1a2e"
  });
  win.once("ready-to-show", () => {
    win.show();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.NODE_ENV === "development") {
    win.loadURL("http://localhost:5173");
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}
app.whenReady().then(() => {
  win = createWindow();
  let queueSync;
  registerIpcHandlers({
    getEngine: () => engine,
    taskRepo,
    settingsRepo,
    telegramRepo,
    get queueSync() {
      if (!queueSync) queueSync = createQueueSync();
      return queueSync;
    },
    getWorkspacePath: () => workspacePath,
    setWorkspacePath: (path2) => {
      workspacePath = path2;
      if (engine) {
        engine.dispose();
        engine = null;
      }
      engine = new EngineManager(path2);
      queueSync = createQueueSync();
      forwardEngineEvents(engine, win);
    },
    win
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  engine?.dispose();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
