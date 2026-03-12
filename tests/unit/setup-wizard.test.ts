import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateBotToken, detectChatId, updateGlobalTelegramConfig, updateProjectTelegramConfig } from '../../src/utils/setup-wizard.js';

// Mock fs
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../src/utils/config.js', () => ({
  QLAUDE_DIR: '.qlaude',
}));

import { existsSync, readFileSync, writeFileSync } from 'fs';

describe('setup-wizard helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateBotToken', () => {
    it('should return bot username for valid token', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          result: { username: 'test_bot' },
        }),
      }));

      const result = await validateBotToken('123:ABC');
      expect(result).toBe('test_bot');
    });

    it('should return null for invalid token', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          ok: false,
          description: 'Unauthorized',
        }),
      }));

      const result = await validateBotToken('invalid');
      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const result = await validateBotToken('123:ABC');
      expect(result).toBeNull();
    });
  });

  describe('detectChatId', () => {
    it('should return chat ID from most recent message', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          result: [
            { message: { chat: { id: 111 } } },
            { message: { chat: { id: 222 } } },
          ],
        }),
      }));

      const result = await detectChatId('123:ABC');
      expect(result).toBe('222');
    });

    it('should return null when no messages', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          result: [],
        }),
      }));

      const result = await detectChatId('123:ABC');
      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const result = await detectChatId('123:ABC');
      expect(result).toBeNull();
    });

    it('should detect chat ID from my_chat_member update', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          result: [
            { update_id: 1, my_chat_member: { chat: { id: 555 } } },
          ],
        }),
      }));

      const result = await detectChatId('123:ABC');
      expect(result).toBe('555');
    });

    it('should prefer most recent update', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        json: () => Promise.resolve({
          ok: true,
          result: [
            { update_id: 1, my_chat_member: { chat: { id: 111 } } },
            { update_id: 2, message: { chat: { id: 222 } } },
          ],
        }),
      }));

      const result = await detectChatId('123:ABC');
      expect(result).toBe('222');
    });
  });

  describe('updateGlobalTelegramConfig', () => {
    it('should merge fields with existing config', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        botToken: 'old',
        chatId: '123',
      }));

      updateGlobalTelegramConfig({ botToken: 'new' });

      const call = vi.mocked(writeFileSync).mock.calls[0];
      const written = JSON.parse(call[1] as string);
      expect(written.botToken).toBe('new');
      expect(written.chatId).toBe('123');
    });

    it('should handle missing config file gracefully', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });

      updateGlobalTelegramConfig({ botToken: '123:ABC' });

      const call = vi.mocked(writeFileSync).mock.calls[0];
      const written = JSON.parse(call[1] as string);
      expect(written.botToken).toBe('123:ABC');
    });

    it('should write to home directory path', () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue('{}');

      updateGlobalTelegramConfig({ botToken: 'test' });

      const call = vi.mocked(writeFileSync).mock.calls[0];
      const filePath = call[0] as string;
      expect(filePath).toContain('.qlaude');
      expect(filePath).toContain('telegram.json');
    });
  });

  describe('updateProjectTelegramConfig', () => {
    it('should merge fields with existing config', () => {
      vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
        enabled: false,
        language: 'en',
      }));

      updateProjectTelegramConfig({ enabled: true });

      const call = vi.mocked(writeFileSync).mock.calls[0];
      const written = JSON.parse(call[1] as string);
      expect(written.enabled).toBe(true);
      expect(written.language).toBe('en');
    });

    it('should write to project directory path', () => {
      vi.mocked(readFileSync).mockReturnValue('{}');

      updateProjectTelegramConfig({ enabled: true });

      const call = vi.mocked(writeFileSync).mock.calls[0];
      const filePath = call[0] as string;
      expect(filePath).toContain('telegram.json');
    });
  });
});
