import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TelegramNotifier } from '../../src/utils/telegram.js';
import type { TelegramConfig } from '../../src/types/config.js';

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('TelegramNotifier', () => {
  const config: TelegramConfig = {
    enabled: true,
    botToken: 'test-token',
    chatId: '12345',
    language: 'en',
    confirmDelayMs: 0,
  };

  const createFetchResponse = () => ({
    ok: true,
    json: async () => ({ ok: true, result: { message_id: 1 } }),
    text: async () => '',
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createFetchResponse()));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should ignore callback queries from non-configured chat', async () => {
    const notifier = new TelegramNotifier(config);
    const commandHandler = vi.fn();
    notifier.on('command', commandHandler);

    const handleCallback = (notifier as unknown as {
      handleCallback: (query: unknown) => Promise<void>;
    }).handleCallback.bind(notifier);

    await handleCallback({
      id: 'cb-1',
      from: { id: 1 },
      message: { message_id: 100, chat: { id: 99999 } },
      data: `pause:${notifier.getInstanceId()}`,
    });

    expect(commandHandler).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should accept callback queries from configured chat', async () => {
    const notifier = new TelegramNotifier(config);
    const commandHandler = vi.fn();
    notifier.on('command', commandHandler);

    const handleCallback = (notifier as unknown as {
      handleCallback: (query: unknown) => Promise<void>;
    }).handleCallback.bind(notifier);

    await handleCallback({
      id: 'cb-2',
      from: { id: 1 },
      message: { message_id: 101, chat: { id: 12345 } },
      data: `pause:${notifier.getInstanceId()}`,
    });

    expect(commandHandler).toHaveBeenCalledWith('pause');
    expect(fetch).toHaveBeenCalled();
  });
});
