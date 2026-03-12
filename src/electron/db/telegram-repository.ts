import type { DB } from './database.js';

export interface TelegramConfig {
  bot_token: string | null;
  chat_id: string | null;
  enabled: boolean;
  validated: boolean;
}

export class TelegramRepository {
  constructor(private db: DB) {}

  private ensureRow(): void {
    const row = this.db.prepare('SELECT id FROM telegram_config WHERE id = 1').get();
    if (!row) {
      this.db.prepare('INSERT INTO telegram_config (id) VALUES (1)').run();
    }
  }

  get(): TelegramConfig {
    this.ensureRow();
    const row = this.db.prepare('SELECT * FROM telegram_config WHERE id = 1').get() as {
      bot_token: string | null;
      chat_id: string | null;
      enabled: number;
      validated: number;
    };
    return {
      bot_token: row.bot_token,
      chat_id: row.chat_id,
      enabled: row.enabled === 1,
      validated: row.validated === 1,
    };
  }

  update(fields: Partial<TelegramConfig>): void {
    this.ensureRow();
    const updates: string[] = [];
    const params: Record<string, unknown> = {};

    if (fields.bot_token !== undefined) {
      updates.push('bot_token = @bot_token');
      params['@bot_token'] = fields.bot_token;
    }
    if (fields.chat_id !== undefined) {
      updates.push('chat_id = @chat_id');
      params['@chat_id'] = fields.chat_id;
    }
    if (fields.enabled !== undefined) {
      updates.push('enabled = @enabled');
      params['@enabled'] = fields.enabled ? 1 : 0;
    }
    if (fields.validated !== undefined) {
      updates.push('validated = @validated');
      params['@validated'] = fields.validated ? 1 : 0;
    }

    if (updates.length === 0) return;

    this.db.prepare(
      `UPDATE telegram_config SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = 1`
    ).run(params);
  }

  isConfigured(): boolean {
    const config = this.get();
    return !!(config.bot_token && config.chat_id && config.validated);
  }
}
