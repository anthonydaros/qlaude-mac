import { DatabaseSync } from 'node:sqlite';
import { join } from 'path';
import { mkdirSync } from 'fs';

export type DB = DatabaseSync;

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

export function initDatabase(dbPath: string): DB {
  const dir = join(dbPath, '..');
  mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(dbPath);

  // WAL mode for better concurrent read performance
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  // Run migrations
  db.exec(CREATE_SCHEMA_VERSION);
  db.exec(CREATE_TASKS);
  db.exec(CREATE_SETTINGS);
  db.exec(CREATE_TELEGRAM_CONFIG);

  // Initialize schema version if needed
  const versionRow = db.prepare('SELECT version FROM schema_version').get() as { version: number } | undefined;
  if (!versionRow) {
    db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(SCHEMA_VERSION);
  }

  return db;
}
