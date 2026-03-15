import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueItem } from '../../../src/types/queue.js';

const registry = vi.hoisted(() => ({
  appendFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  readSessionId: vi.fn(),
  deleteSessionId: vi.fn(),
  getSessionFilePath: vi.fn(),
  extractConversations: vi.fn(),
  formatConversationsForLog: vi.fn(),
  getSessionLogOffset: vi.fn(),
  saveSessionLogOffset: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  appendFileSync: registry.appendFileSync,
  writeFileSync: registry.writeFileSync,
  existsSync: registry.existsSync,
  mkdirSync: registry.mkdirSync,
  readdirSync: registry.readdirSync,
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: registry.logger,
}));

vi.mock('../../../src/utils/session-log-extractor.js', () => ({
  getSessionFilePath: registry.getSessionFilePath,
  extractConversations: registry.extractConversations,
  formatConversationsForLog: registry.formatConversationsForLog,
}));

vi.mock('../../../src/utils/hook-setup.js', () => ({
  readSessionId: registry.readSessionId,
  deleteSessionId: registry.deleteSessionId,
}));

vi.mock('../../../src/utils/session-log-offsets.js', () => ({
  getSessionLogOffset: registry.getSessionLogOffset,
  saveSessionLogOffset: registry.saveSessionLogOffset,
}));

async function loadSubject() {
  vi.resetModules();
  registry.appendFileSync.mockReset();
  registry.writeFileSync.mockReset();
  registry.existsSync.mockReset();
  registry.mkdirSync.mockReset();
  registry.readdirSync.mockReset();
  registry.readSessionId.mockReset();
  registry.deleteSessionId.mockReset();
  registry.getSessionFilePath.mockReset();
  registry.extractConversations.mockReset();
  registry.formatConversationsForLog.mockReset();
  registry.getSessionLogOffset.mockReset();
  registry.saveSessionLogOffset.mockReset();
  registry.logger.debug.mockReset();
  registry.logger.info.mockReset();
  registry.logger.warn.mockReset();
  registry.logger.error.mockReset();
  return import('../../../src/utils/conversation-logger.js');
}

describe('conversation-logger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
  });

  it('should initialize the main log file when enabled', async () => {
    const { ConversationLogger } = await loadSubject();
    registry.readSessionId.mockReturnValue('session-1');
    registry.existsSync.mockReturnValue(false);

    const subject = new ConversationLogger({
      enabled: true,
      filePath: '.qlaude/conversation.log',
      timestamps: true,
    });

    expect(subject.isEnabled()).toBe(true);
    expect(subject.getCurrentSessionId()).toBe('session-1');
    expect(registry.mkdirSync).toHaveBeenCalled();
    expect(registry.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('.qlaude/conversation.log'),
      expect.stringContaining('# Qlaude Conversation Log'),
      'utf-8'
    );
  });

  it('should skip initialization work when disabled', async () => {
    const { ConversationLogger } = await loadSubject();
    registry.readSessionId.mockReturnValue(null);

    const subject = new ConversationLogger({
      enabled: false,
      filePath: '.qlaude/conversation.log',
      timestamps: true,
    });
    subject.setSessionId('ignored');

    expect(subject.isEnabled()).toBe(false);
    expect(subject.getCurrentSessionId()).toBeNull();
    expect(registry.writeFileSync).not.toHaveBeenCalled();
  });

  it('should create queue logs and append formatted queue items', async () => {
    const { ConversationLogger } = await loadSubject();
    registry.readSessionId.mockReturnValue('session-2');
    registry.existsSync.mockReturnValue(false);

    const subject = new ConversationLogger({
      enabled: true,
      filePath: '.qlaude/conversation.log',
      timestamps: true,
    });
    subject.logQueueStarted();

    const multilineItem: QueueItem = {
      prompt: 'line 1\nline 2',
      isMultiline: true,
      isNewSession: true,
    };
    const breakpointItem: QueueItem = {
      prompt: 'Need review',
      isBreakpoint: true,
    };
    subject.logQueueItem(multilineItem);
    subject.logQueueItem(breakpointItem);

    expect(subject.getCurrentQueueLogPath()).toContain('queue-2026-01-02T03-04-05.log');
    expect(registry.appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('queue-2026-01-02T03-04-05.log'),
      expect.stringContaining('>>>('),
      'utf-8'
    );
    expect(registry.appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('queue-2026-01-02T03-04-05.log'),
      expect.stringContaining('>># Need review'),
      'utf-8'
    );
  });

  it('should extract incremental conversations during session transitions and completion', async () => {
    const { ConversationLogger } = await loadSubject();
    registry.existsSync.mockImplementation((candidate: string) => (
      String(candidate).includes('conversation.log') ||
      String(candidate).includes('queue-logs')
    ));
    registry.readSessionId.mockReturnValue('session-3');
    registry.getSessionFilePath.mockReturnValue('/tmp/session-3.jsonl');
    registry.extractConversations.mockReturnValue([
      { timestamp: '2026-01-02T03:00:00.000Z', question: 'Q1', answer: 'A1' },
      { timestamp: '2026-01-02T03:01:00.000Z', question: 'Q2', answer: 'A2' },
    ]);
    registry.formatConversationsForLog.mockReturnValue('formatted conversations');
    registry.getSessionLogOffset.mockReturnValue(1);

    const subject = new ConversationLogger({
      enabled: true,
      filePath: '.qlaude/conversation.log',
      timestamps: false,
    });
    subject.logQueueStarted();
    subject.refreshSessionId();
    subject.logNewSessionStarting({
      prompt: '',
      loadSessionLabel: 'saved',
      resumeSessionId: 'session-3',
    });
    subject.logQueueCompleted();

    expect(registry.appendFileSync).toHaveBeenCalledWith(
      expect.stringContaining('queue-2026-01-02T03-04-05.log'),
      'formatted conversations',
      'utf-8'
    );
    expect(registry.saveSessionLogOffset).toHaveBeenCalledWith('session-3', 2);
    expect(registry.deleteSessionId).toHaveBeenCalled();
    expect(subject.getCurrentQueueLogPath()).toBeNull();
  });

  it('should handle missing sessions, recovered latest logs and append failures gracefully', async () => {
    const { ConversationLogger } = await loadSubject();
    registry.existsSync.mockImplementation((candidate: string) => String(candidate).includes('queue-logs'));
    registry.readdirSync.mockReturnValue(['queue-2026-01-01.log', 'queue-2026-01-03.log']);
    registry.readSessionId.mockReturnValue(null);
    registry.appendFileSync.mockImplementation(() => {
      throw new Error('append failed');
    });

    const subject = new ConversationLogger({
      enabled: true,
      filePath: '.qlaude/conversation.log',
      timestamps: true,
    });

    subject.logQueueStarted();
    subject.logQueueItem({ prompt: 'plain item' });
    subject.logQueueCompleted();

    expect(subject.getLatestQueueLogPath()).toContain('queue-2026-01-03.log');
    expect(registry.logger.warn).toHaveBeenCalledWith('No session ID available, skipping extraction');
    expect(registry.logger.error).toHaveBeenCalled();
  });

  it('should log label, load and plain new-session queue items with their specific prefixes', async () => {
    const { ConversationLogger } = await loadSubject();
    registry.readSessionId.mockReturnValue('session-4');
    registry.existsSync.mockReturnValue(false);

    const subject = new ConversationLogger({
      enabled: true,
      filePath: '.qlaude/conversation.log',
      timestamps: true,
    });
    subject.logQueueStarted();
    subject.logQueueItem({ prompt: '', labelSession: 'release' });
    subject.logQueueItem({ prompt: '', loadSessionLabel: 'saved-session' });
    subject.logQueueItem({ prompt: 'resume work', loadSessionLabel: 'saved-session' });
    subject.logQueueItem({ prompt: '', isNewSession: true });

    expect(registry.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('>>{Label:release}'),
      'utf-8'
    );
    expect(registry.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('>>>{Load:saved-session}'),
      'utf-8'
    );
    expect(registry.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('>>>{Load:saved-session} resume work'),
      'utf-8'
    );
    expect(registry.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Queue: >>>\n'),
      'utf-8'
    );
  });

  it('should skip appending when no new conversations are available and keep the extracted count', async () => {
    const { ConversationLogger } = await loadSubject();
    registry.existsSync.mockImplementation((candidate: string) => (
      String(candidate).includes('conversation.log') ||
      String(candidate).includes('queue-logs')
    ));
    registry.readSessionId.mockReturnValue('session-5');
    registry.getSessionFilePath.mockReturnValue('/tmp/session-5.jsonl');
    registry.extractConversations.mockReturnValue([
      { timestamp: '2026-01-02T03:00:00.000Z', question: 'Q1', answer: 'A1' },
    ]);
    registry.getSessionLogOffset.mockReturnValue(1);

    const subject = new ConversationLogger({
      enabled: true,
      filePath: '.qlaude/conversation.log',
      timestamps: true,
    });
    subject.logQueueStarted();
    registry.readSessionId.mockReturnValue('session-5b');
    subject.refreshSessionId();
    registry.appendFileSync.mockClear();
    subject.logQueueCompleted();

    expect(registry.appendFileSync).toHaveBeenCalledTimes(1);
    expect(registry.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Queue execution completed'),
      'utf-8'
    );
    expect(registry.saveSessionLogOffset).not.toHaveBeenCalled();
    expect(registry.logger.debug).toHaveBeenCalledWith('No new conversations to extract');
  });

  it('should handle new-session log variants, session-path misses and accessor helpers', async () => {
    const { ConversationLogger } = await loadSubject();
    registry.existsSync.mockImplementation((candidate: string) => (
      String(candidate).includes('conversation.log') ||
      String(candidate).includes('queue-logs')
    ));
    registry.readSessionId.mockReturnValue('session-6');
    registry.getSessionFilePath.mockReturnValue(null);

    const subject = new ConversationLogger({
      enabled: true,
      filePath: '.qlaude/conversation.log',
      timestamps: true,
    });

    expect(subject.getFilePath()).toContain('.qlaude/conversation.log');

    subject.logQueueStarted();
    const currentQueueLogPath = subject.getCurrentQueueLogPath();
    expect(subject.getLatestQueueLogPath()).toBe(currentQueueLogPath);

    subject.logNewSessionStarting({ prompt: '', loadSessionLabel: 'saved-only' });
    subject.setSessionId('session-6');
    subject.logNewSessionStarting({ prompt: '', resumeSessionId: 'resume-12345678' });

    expect(registry.logger.warn).toHaveBeenCalledWith(
      { sessionId: 'session-6' },
      'Session file not found'
    );
    expect(registry.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Loading "saved-only"'),
      'utf-8'
    );
    expect(registry.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Resuming resume-1...'),
      'utf-8'
    );
  });
});
