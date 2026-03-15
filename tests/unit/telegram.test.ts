import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { TelegramNotifier } from '../../src/utils/telegram.js';
import type { TelegramConfig } from '../../src/types/config.js';

const loggerRegistry = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: loggerRegistry,
}));

function createFetchResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function parseJsonBody(call: unknown[]): Record<string, unknown> {
  return JSON.parse((call[1] as RequestInit).body as string) as Record<string, unknown>;
}

describe('TelegramNotifier', () => {
  const config: TelegramConfig = {
    enabled: true,
    botToken: 'test-token',
    chatId: '12345',
    language: 'en',
    confirmDelayMs: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(createFetchResponse({
      ok: true,
      result: { message_id: 1 },
    })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should ignore invalid callback targets and accept matching callback queries', async () => {
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
    await handleCallback({
      id: 'cb-2',
      from: { id: 1 },
      message: { message_id: 101, chat: { id: 12345 } },
      data: 'invalid',
    });
    await handleCallback({
      id: 'cb-3',
      from: { id: 1 },
      message: { message_id: 102, chat: { id: 12345 } },
      data: 'pause:other-host:999',
    });

    expect(commandHandler).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    await handleCallback({
      id: 'cb-4',
      from: { id: 1 },
      message: { message_id: 103, chat: { id: 12345 } },
      data: `pause:${notifier.getInstanceId()}`,
    });

    expect(commandHandler).toHaveBeenCalledWith('pause');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('should request text input through callbacks and confirm replies', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(createFetchResponse({ ok: true }))
      .mockResolvedValueOnce(createFetchResponse({ ok: true, result: { message_id: 404 } }))
      .mockResolvedValueOnce(createFetchResponse({ ok: true }))
      .mockResolvedValueOnce(createFetchResponse({ ok: true, result: { message_id: 405 } }));

    const notifier = new TelegramNotifier(config);
    const textInputHandler = vi.fn();
    notifier.on('text_input', textInputHandler);

    const handleCallback = (notifier as unknown as {
      handleCallback: (query: unknown) => Promise<void>;
    }).handleCallback.bind(notifier);
    const handleMessage = (notifier as unknown as {
      handleMessage: (message: unknown) => Promise<void>;
    }).handleMessage.bind(notifier);

    await handleCallback({
      id: 'cb-text',
      from: { id: 1 },
      message: { message_id: 77, chat: { id: 12345 } },
      data: `textinput5:${notifier.getInstanceId()}`,
    });

    await handleMessage({
      message_id: 88,
      from: { id: 1 },
      chat: { id: 12345 },
      text: 'details for option',
      date: Math.floor(Date.now() / 1000),
      reply_to_message: { message_id: 404 },
    });

    expect(textInputHandler).toHaveBeenCalledWith(5, 'details for option');
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(parseJsonBody(vi.mocked(fetch).mock.calls[1]).reply_markup).toEqual({
      force_reply: true,
      selective: true,
      input_field_placeholder: 'Enter text...',
    });
  });

  it('should route replies and slash commands to the correct events', async () => {
    const notifier = new TelegramNotifier(config);
    const commandHandler = vi.fn();
    const statusHandler = vi.fn();
    const logHandler = vi.fn();
    const displayHandler = vi.fn();
    const sendTextHandler = vi.fn();
    const keyInputHandler = vi.fn();

    notifier.on('command', commandHandler);
    notifier.on('status_request', statusHandler);
    notifier.on('log_request', logHandler);
    notifier.on('display_request', displayHandler);
    notifier.on('send_text', sendTextHandler);
    notifier.on('key_input', keyInputHandler);

    const handleMessage = (notifier as unknown as {
      handleMessage: (message: unknown) => Promise<void>;
    }).handleMessage.bind(notifier);

    (notifier as unknown as { lastNotificationMessageId: number | null }).lastNotificationMessageId = 501;

    await handleMessage({
      message_id: 1,
      from: { id: 1 },
      chat: { id: 99999 },
      text: '/pause',
      date: Math.floor(Date.now() / 1000),
    });

    await handleMessage({
      message_id: 2,
      from: { id: 1 },
      chat: { id: 12345 },
      text: 'stale reply',
      date: Math.floor(Date.now() / 1000) - 500,
      reply_to_message: { message_id: 501 },
    });

    await handleMessage({
      message_id: 3,
      from: { id: 1 },
      chat: { id: 12345 },
      text: 'send this reply',
      date: Math.floor(Date.now() / 1000),
      reply_to_message: { message_id: 501 },
    });

    await handleMessage({
      message_id: 4,
      from: { id: 1 },
      chat: { id: 12345 },
      text: '/send',
      date: Math.floor(Date.now() / 1000),
    });

    await handleMessage({
      message_id: 5,
      from: { id: 1 },
      chat: { id: 12345 },
      text: '/send other-host:123 text',
      date: Math.floor(Date.now() / 1000),
    });

    await handleMessage({
      message_id: 6,
      from: { id: 1 },
      chat: { id: 12345 },
      text: `/send ${notifier.getInstanceId()} direct message`,
      date: Math.floor(Date.now() / 1000),
    });

    await handleMessage({
      message_id: 7,
      from: { id: 1 },
      chat: { id: 12345 },
      text: '/key hotkey',
      date: Math.floor(Date.now() / 1000),
    });

    await handleMessage({
      message_id: 8,
      from: { id: 1 },
      chat: { id: 12345 },
      text: '/pause',
      date: Math.floor(Date.now() / 1000),
    });

    await handleMessage({
      message_id: 9,
      from: { id: 1 },
      chat: { id: 12345 },
      text: `/resume ${notifier.getInstanceId()}`,
      date: Math.floor(Date.now() / 1000),
    });

    await handleMessage({
      message_id: 10,
      from: { id: 1 },
      chat: { id: 12345 },
      text: '/status',
      date: Math.floor(Date.now() / 1000),
    });

    await handleMessage({
      message_id: 11,
      from: { id: 1 },
      chat: { id: 12345 },
      text: '/log',
      date: Math.floor(Date.now() / 1000),
    });

    await handleMessage({
      message_id: 12,
      from: { id: 1 },
      chat: { id: 12345 },
      text: '/display',
      date: Math.floor(Date.now() / 1000),
    });

    expect(sendTextHandler).toHaveBeenCalledWith('send this reply');
    expect(sendTextHandler).toHaveBeenCalledWith('direct message');
    expect(keyInputHandler).toHaveBeenCalledWith('hotkey');
    expect(commandHandler).toHaveBeenCalledWith('pause');
    expect(commandHandler).toHaveBeenCalledWith('resume');
    expect(statusHandler).toHaveBeenCalledWith(12345, 10);
    expect(logHandler).toHaveBeenCalledWith(12345, 11);
    expect(displayHandler).toHaveBeenCalledWith(12345, 12);
  });

  it('should schedule selection notifications and debounce duplicate immediate notifications', async () => {
    vi.useFakeTimers();
    const notifier = new TelegramNotifier({
      ...config,
      templates: {
        selection_prompt: '{title}\n{context}\n{options}',
        breakpoint: 'BREAK {reason}',
      },
    });

    await notifier.notify('breakpoint', {
      message: 'Need _review_',
      queueLength: 2,
    });
    await notifier.notify('breakpoint', {
      message: 'Need _review_',
      queueLength: 2,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const breakpointBody = parseJsonBody(vi.mocked(fetch).mock.calls[0]);
    expect(String(breakpointBody.text)).toContain('BREAK Need \\_review\\_');

    vi.mocked(fetch).mockClear();
    notifier.resetNotificationDebounce();

    await notifier.notify('selection_prompt', {
      queueLength: 3,
      context: '\u001b[31mChoice A\nEnter to select\n─────\nC:\\temp\\file',
      options: [
        { number: 1, text: 'Approve', isTextInput: false },
        { number: 2, text: 'Explain path C:\\temp', isTextInput: true },
      ],
    });

    await vi.advanceTimersByTimeAsync(800);

    expect(fetch).toHaveBeenCalledTimes(1);
    const selectionBody = parseJsonBody(vi.mocked(fetch).mock.calls[0]);
    expect(String(selectionBody.text)).toContain('Input Required');
    expect(String(selectionBody.text)).toContain('Choice A');
    expect(String(selectionBody.text)).toContain('C:\\\\temp\\\\file');
    expect(String(selectionBody.text)).not.toContain('Enter to select');
    expect(selectionBody.reply_markup).toEqual({
      inline_keyboard: [
        [
          { text: '1', callback_data: `select1:${notifier.getInstanceId()}` },
          { text: '2✏️', callback_data: `textinput2:${notifier.getInstanceId()}` },
        ],
        [
          { text: '⬅️ Cancel', callback_data: `escape:${notifier.getInstanceId()}` },
        ],
      ],
    });
  });

  it('should start polling, process updates, advance offsets and stop cleanly', async () => {
    vi.useFakeTimers();

    const notifier = new TelegramNotifier(config);
    const statusHandler = vi.fn();
    notifier.on('status_request', statusHandler);

    vi.mocked(fetch).mockImplementation(async (url: string) => {
      if (url.includes('getUpdates')) {
        return createFetchResponse({
          ok: true,
          result: [
            {
              update_id: 1,
              message: {
                message_id: 10,
                from: { id: 1 },
                chat: { id: 12345 },
                text: '/status',
                date: Math.floor(Date.now() / 1000),
              },
            },
            {
              update_id: 2,
              callback_query: {
                id: 'cb-9',
                from: { id: 1 },
                message: { message_id: 11, chat: { id: 12345 } },
                data: `resume:${notifier.getInstanceId()}`,
              },
            },
          ],
        });
      }

      return createFetchResponse({ ok: true, result: { message_id: 12 } });
    });

    notifier.startPolling();
    expect((notifier as unknown as { pollingActive: boolean }).pollingActive).toBe(true);
    notifier.stopPolling();

    const pollUpdates = (notifier as unknown as {
      pollUpdates: () => Promise<void>;
    }).pollUpdates.bind(notifier);
    await pollUpdates();

    expect(statusHandler).toHaveBeenCalledWith(12345, 10);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain('getUpdates');
    expect((notifier as unknown as { confirmedOffset: number }).confirmedOffset).toBe(2);
    expect((notifier as unknown as { pollingActive: boolean }).pollingActive).toBe(false);
  });

  it('should send plain messages, upload documents and expose formatting helpers', async () => {
    const notifier = new TelegramNotifier({
      ...config,
      templates: {
        default: '{title}\n{project}\n{context}\n{options}',
      },
    });

    await notifier.sendPlainMessage('status ok');
    expect(parseJsonBody(vi.mocked(fetch).mock.calls[0]).text).toBe('status ok');

    const tempDir = mkdtempSync(join(tmpdir(), 'qlaude-telegram-'));
    const documentPath = join(tempDir, 'log.txt');
    writeFileSync(documentPath, 'document content', 'utf-8');

    try {
      await expect(notifier.sendDocument(12345, 9, documentPath, 'caption')).resolves.toBe(true);
      const formData = vi.mocked(fetch).mock.calls[1][1]?.body as FormData;
      expect(formData.get('chat_id')).toBe('12345');
      expect(formData.get('reply_to_message_id')).toBe('9');
      expect(formData.get('caption')).toBe('caption');

      await expect(notifier.sendDocument(12345, 9, join(tempDir, 'missing.log'))).resolves.toBe(false);

      vi.mocked(fetch).mockResolvedValueOnce(createFetchResponse({}, false, 500));
      await expect(notifier.sendDocument(12345, 9, documentPath)).resolves.toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    const renderTemplate = (notifier as unknown as {
      renderTemplate: (template: string, vars: Record<string, string>) => string;
    }).renderTemplate.bind(notifier);
    const cleanContext = (notifier as unknown as {
      cleanContext: (context: string) => string;
    }).cleanContext.bind(notifier);
    const escapeMarkdown = (notifier as unknown as {
      escapeMarkdown: (text: string) => string;
    }).escapeMarkdown.bind(notifier);
    const formatMessage = (notifier as unknown as {
      formatMessage: (type: 'queue_started', details?: { queueLength?: number; context?: string }) => string;
    }).formatMessage.bind(notifier);

    expect(renderTemplate('A\n{empty}\nB', { empty: '' })).toBe('A\nB');
    expect(cleanContext('\u001b[31mLine\nEnter to select\n─────\n  keep me')).toBe('Line\n  keep me');
    expect(escapeMarkdown('C:\\temp_[1]!')).toBe('C:/temp\\_\\[1\\]\\!');
    expect(formatMessage('queue_started', { queueLength: 4, context: 'ctx' })).toContain('Queue Started');
  });
});
