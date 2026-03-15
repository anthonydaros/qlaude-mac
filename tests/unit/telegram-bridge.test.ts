import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { setupTelegramBridge } from '../../src/telegram-bridge.js';
import { t } from '../../src/utils/telegram-messages.js';

const registry = vi.hoisted(() => ({
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  getSessionFilePath: vi.fn(),
  extractConversations: vi.fn(),
  formatConversationsForLog: vi.fn(),
  hostname: vi.fn().mockReturnValue('test-host'),
  randomUUID: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  existsSync: registry.existsSync,
  writeFileSync: registry.writeFileSync,
  unlinkSync: registry.unlinkSync,
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    hostname: registry.hostname,
  };
});

vi.mock('crypto', () => ({
  randomUUID: registry.randomUUID,
}));

vi.mock('../../src/utils/session-log-extractor.js', () => ({
  getSessionFilePath: registry.getSessionFilePath,
  extractConversations: registry.extractConversations,
  formatConversationsForLog: registry.formatConversationsForLog,
}));

class MockTelegramNotifier extends EventEmitter {
  replyToChat = vi.fn();
  sendDocument = vi.fn();
  getInstanceId = vi.fn().mockReturnValue('host:123');
}

function createContext() {
  return {
    telegramNotifier: new MockTelegramNotifier(),
    ptyWrapper: {
      write: vi.fn(),
      isRunning: vi.fn().mockReturnValue(true),
    },
    autoExecutor: {
      stop: vi.fn(),
      start: vi.fn(),
      isEnabled: vi.fn().mockReturnValue(true),
    },
    stateDetector: {
      forceReady: vi.fn(),
      getState: vi.fn().mockReturnValue({ type: 'READY' }),
    },
    display: {
      showMessage: vi.fn(),
      setPaused: vi.fn(),
    },
    queueManager: {
      getLength: vi.fn().mockReturnValue(3),
    },
    conversationLogger: {
      getLatestQueueLogPath: vi.fn().mockReturnValue(null),
      refreshSessionId: vi.fn(),
      getCurrentSessionId: vi.fn().mockReturnValue(null),
    },
    terminalEmulator: {
      getLastLines: vi.fn().mockReturnValue(['\u001b[31mline 1\u001b[0m', 'line 2']),
    },
    setInputBuffer: vi.fn(),
    cwd: '/tmp/workspace',
  };
}

describe('setupTelegramBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    registry.existsSync.mockReturnValue(false);
    registry.formatConversationsForLog.mockReturnValue('');
    registry.randomUUID.mockReturnValue('uuid-default');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should pause and resume auto-execution from Telegram commands', () => {
    const ctx = createContext();

    setupTelegramBridge(ctx);

    ctx.telegramNotifier.emit('command', 'pause');
    ctx.telegramNotifier.emit('command', 'resume');

    expect(ctx.autoExecutor.stop).toHaveBeenCalledTimes(1);
    expect(ctx.autoExecutor.start).toHaveBeenCalledTimes(1);
    expect(ctx.display.setPaused).toHaveBeenNthCalledWith(1, true);
    expect(ctx.display.setPaused).toHaveBeenNthCalledWith(2, false);
    expect(ctx.stateDetector.forceReady).toHaveBeenCalledTimes(1);
  });

  it('should handle numbered selection and escape commands', () => {
    const ctx = createContext();
    setupTelegramBridge(ctx);

    ctx.telegramNotifier.emit('command', 'select12');
    ctx.telegramNotifier.emit('command', 'escape');

    expect(ctx.setInputBuffer).toHaveBeenNthCalledWith(1, '');
    expect(ctx.setInputBuffer).toHaveBeenNthCalledWith(2, '');
    expect(ctx.ptyWrapper.write).toHaveBeenNthCalledWith(1, '12');
    expect(ctx.ptyWrapper.write).toHaveBeenNthCalledWith(2, '\x1b');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('info', '[Telegram] Option 12 selected');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('info', '[Telegram] Selection cancelled');
  });

  it('should reply with a formatted paused status report', () => {
    const ctx = createContext();
    ctx.autoExecutor.isEnabled.mockReturnValue(false);
    ctx.ptyWrapper.isRunning.mockReturnValue(false);
    ctx.stateDetector.getState.mockReturnValue({ type: 'PROCESSING' });

    setupTelegramBridge(ctx);
    ctx.telegramNotifier.emit('status_request', 20, 21);

    expect(ctx.telegramNotifier.replyToChat).toHaveBeenCalledWith(
      20,
      21,
      [
        t('status.header'),
        '',
        '🖥️ host:123',
        '📁 workspace',
        '',
        t('status.pty', { status: t('status.pty_stopped') }),
        t('status.state', { state: 'PROCESSING' }),
        t('status.autoexec', { status: t('status.autoexec_paused') }),
        `${t('queue.label')}: ${t('queue.items', { count: 3 })}`,
      ].join('\n')
    );
  });

  it('should send queue and session logs when both are available', async () => {
    const ctx = createContext();
    ctx.conversationLogger.getLatestQueueLogPath.mockReturnValue('/tmp/queue.log');
    ctx.conversationLogger.getCurrentSessionId.mockReturnValue('session-12345678');
    ctx.telegramNotifier.sendDocument
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true);
    registry.existsSync.mockImplementation((candidate: string) => (
      candidate === '/tmp/queue.log' ||
      candidate === '/tmp/session.jsonl' ||
      candidate === '/tmp/session-session-.log'
    ));
    registry.getSessionFilePath.mockReturnValue('/tmp/session.jsonl');
    registry.extractConversations.mockReturnValue([{ question: 'Q', answer: 'A', timestamp: '2026-01-01T00:00:00.000Z' }]);
    registry.formatConversationsForLog.mockReturnValue('formatted session log');

    setupTelegramBridge(ctx);
    ctx.telegramNotifier.emit('log_request', 30, 31);

    await vi.waitFor(() => expect(ctx.telegramNotifier.sendDocument).toHaveBeenCalledTimes(2));
    const tempPath = registry.writeFileSync.mock.calls[0]?.[0];
    expect(tempPath).toEqual(expect.stringContaining('session-session--uuid-default.log'));
    expect(registry.writeFileSync).toHaveBeenCalledWith(tempPath, 'formatted session log', 'utf-8');
    expect(ctx.telegramNotifier.sendDocument).toHaveBeenNthCalledWith(
      1,
      30,
      31,
      '/tmp/queue.log',
      t('log.queue_caption', { instanceId: 'host:123' })
    );
    expect(ctx.telegramNotifier.sendDocument).toHaveBeenNthCalledWith(
      2,
      30,
      31,
      tempPath,
      t('log.session_caption')
    );
    expect(registry.unlinkSync).toHaveBeenCalledWith(tempPath);
    expect(ctx.telegramNotifier.replyToChat).toHaveBeenCalledWith(30, 31, t('log.sent', { count: 2 }));
  });

  it('should create a unique temp file per log export request for the same session', async () => {
    const ctx = createContext();
    ctx.conversationLogger.getCurrentSessionId.mockReturnValue('session-12345678');
    ctx.telegramNotifier.sendDocument.mockImplementation(async () => {
      await Promise.resolve();
      return true;
    });
    registry.randomUUID
      .mockReturnValueOnce('uuid-one')
      .mockReturnValueOnce('uuid-two');
    registry.existsSync.mockImplementation((candidate: string) => candidate === '/tmp/session.jsonl');
    registry.getSessionFilePath.mockReturnValue('/tmp/session.jsonl');
    registry.extractConversations.mockReturnValue([{ question: 'Q', answer: 'A', timestamp: '2026-01-01T00:00:00.000Z' }]);
    registry.formatConversationsForLog.mockReturnValue('formatted session log');

    setupTelegramBridge(ctx);

    ctx.telegramNotifier.emit('log_request', 40, 41);
    ctx.telegramNotifier.emit('log_request', 42, 43);

    await vi.waitFor(() => expect(ctx.telegramNotifier.sendDocument).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(registry.unlinkSync).toHaveBeenCalledTimes(2));

    const firstTempPath = registry.writeFileSync.mock.calls[0]?.[0];
    const secondTempPath = registry.writeFileSync.mock.calls[1]?.[0];

    expect(firstTempPath).toEqual(expect.stringContaining('session-session--uuid-one.log'));
    expect(secondTempPath).toEqual(expect.stringContaining('session-session--uuid-two.log'));
    expect(firstTempPath).not.toBe(secondTempPath);
    expect(ctx.telegramNotifier.sendDocument).toHaveBeenNthCalledWith(
      1,
      40,
      41,
      firstTempPath,
      t('log.session_caption')
    );
    expect(ctx.telegramNotifier.sendDocument).toHaveBeenNthCalledWith(
      2,
      42,
      43,
      secondTempPath,
      t('log.session_caption')
    );
    expect(registry.unlinkSync).toHaveBeenCalledWith(firstTempPath);
    expect(registry.unlinkSync).toHaveBeenCalledWith(secondTempPath);
  });

  it('should reply that no logs are available when nothing can be sent', async () => {
    const ctx = createContext();
    ctx.conversationLogger.getLatestQueueLogPath.mockReturnValue(null);
    ctx.conversationLogger.getCurrentSessionId.mockReturnValue(null);

    setupTelegramBridge(ctx);
    ctx.telegramNotifier.emit('log_request', 32, 33);

    await vi.waitFor(() => expect(ctx.telegramNotifier.replyToChat).toHaveBeenCalledWith(32, 33, t('log.none')));
    expect(ctx.telegramNotifier.sendDocument).not.toHaveBeenCalled();
  });

  it('should strip ANSI sequences before replying to display requests', () => {
    const ctx = createContext();

    setupTelegramBridge(ctx);

    ctx.telegramNotifier.emit('display_request', 10, 11);

    expect(ctx.telegramNotifier.replyToChat).toHaveBeenCalledWith(
      10,
      11,
      expect.stringContaining('line 1\nline 2')
    );
    expect(ctx.telegramNotifier.replyToChat).not.toHaveBeenCalledWith(
      10,
      11,
      expect.stringContaining('\u001b')
    );
  });

  it('should reply with an empty display message when there are no screen lines', () => {
    const ctx = createContext();
    ctx.terminalEmulator.getLastLines.mockReturnValue([]);

    setupTelegramBridge(ctx);
    ctx.telegramNotifier.emit('display_request', 12, 13);

    expect(ctx.telegramNotifier.replyToChat).toHaveBeenCalledWith(12, 13, t('display.empty'));
  });

  it('should reply with an empty display message when ANSI cleanup removes all content', () => {
    const ctx = createContext();
    ctx.terminalEmulator.getLastLines.mockReturnValue(['\u001b[0m']);

    setupTelegramBridge(ctx);
    ctx.telegramNotifier.emit('display_request', 14, 15);

    expect(ctx.telegramNotifier.replyToChat).toHaveBeenCalledWith(14, 15, t('display.empty'));
  });

  it('should truncate large display payloads before replying', () => {
    const ctx = createContext();
    ctx.terminalEmulator.getLastLines.mockReturnValue(['x'.repeat(4005)]);

    setupTelegramBridge(ctx);
    ctx.telegramNotifier.emit('display_request', 16, 17);

    expect(ctx.telegramNotifier.replyToChat).toHaveBeenCalledWith(
      16,
      17,
      expect.stringContaining('...(truncated)')
    );
  });

  it('should send option number, text and enter for text input replies', () => {
    const ctx = createContext();

    setupTelegramBridge(ctx);

    ctx.telegramNotifier.emit('text_input', 2, 'details');

    expect(ctx.ptyWrapper.write).toHaveBeenNthCalledWith(1, '2');

    vi.advanceTimersByTime(150);
    expect(ctx.ptyWrapper.write).toHaveBeenNthCalledWith(2, 'details');

    vi.advanceTimersByTime(100);
    expect(ctx.ptyWrapper.write).toHaveBeenNthCalledWith(3, '\r');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('info', '[Telegram] #2 + "details" sent');
  });

  it('should truncate long text previews for text_input, send_text and key_input', () => {
    const ctx = createContext();
    const longText = '12345678901234567890-extra';

    setupTelegramBridge(ctx);

    ctx.telegramNotifier.emit('text_input', 5, longText);
    vi.advanceTimersByTime(250);
    ctx.telegramNotifier.emit('send_text', longText);
    vi.advanceTimersByTime(100);
    ctx.telegramNotifier.emit('key_input', longText);

    expect(ctx.display.showMessage).toHaveBeenCalledWith('info', '[Telegram] #5 + "12345678901234567890..." sent');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('info', '[Telegram] "12345678901234567890..." sent');
    expect(ctx.display.showMessage).toHaveBeenCalledWith('info', '[Telegram] ⌨️ "12345678901234567890..." typed');
  });
});
