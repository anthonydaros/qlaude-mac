import { beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  existsSync: registry.existsSync,
  readFileSync: registry.readFileSync,
}));

vi.mock('os', () => ({
  homedir: () => '/Users/test',
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: registry.logger,
}));

async function loadSubject() {
  vi.resetModules();
  registry.existsSync.mockReset();
  registry.readFileSync.mockReset();
  registry.logger.debug.mockReset();
  registry.logger.error.mockReset();
  registry.logger.warn.mockReset();
  return import('../../../src/utils/session-log-extractor.js');
}

describe('session-log-extractor', () => {
  it('should list existing session ids and ignore invalid indexes', async () => {
    const subject = await loadSubject();
    const projectFolder = '/Users/test/.claude/projects/my-project';
    const indexPath = `${projectFolder}/sessions-index.json`;

    registry.existsSync.mockImplementation((candidate: string) => (
      candidate === '/Users/test/.claude/projects' ||
      candidate === projectFolder ||
      candidate === indexPath
    ));
    registry.readFileSync.mockImplementation((candidate: string) => {
      if (candidate === indexPath) {
        return JSON.stringify({
          version: 1,
          entries: [
            { sessionId: 'alpha', modified: '2026-01-01T00:00:00.000Z' },
            { sessionId: 'beta', modified: '2026-01-01T01:00:00.000Z' },
          ],
        });
      }
      return '';
    });

    expect(subject.getExistingSessionIds('my-project')).toEqual(new Set(['alpha', 'beta']));

    registry.readFileSync.mockImplementation(() => {
      throw new Error('broken');
    });
    expect(subject.getExistingSessionIds('my-project')).toEqual(new Set());
    expect(registry.logger.error).toHaveBeenCalled();
  });

  it('should find only new sessions created after the snapshot and resolve the current session', async () => {
    const subject = await loadSubject();
    const projectFolder = '/Users/test/.claude/projects/my-project';
    const indexPath = `${projectFolder}/sessions-index.json`;

    registry.existsSync.mockImplementation((candidate: string) => (
      candidate === '/Users/test/.claude/projects' ||
      candidate === projectFolder ||
      candidate === indexPath
    ));
    registry.readFileSync.mockImplementation(() => JSON.stringify({
      version: 1,
      entries: [
        {
          sessionId: 'old',
          created: '2026-01-01T00:00:00.000Z',
          modified: '2026-01-01T00:00:00.000Z',
        },
        {
          sessionId: 'newer',
          created: '2026-01-02T00:00:00.000Z',
          modified: '2026-01-03T00:00:00.000Z',
        },
        {
          sessionId: 'newest',
          created: '2026-01-04T00:00:00.000Z',
          modified: '2026-01-05T00:00:00.000Z',
        },
      ],
    }));

    expect(subject.findNewSessionId(
      'my-project',
      new Set(['old']),
      new Date('2026-01-02T12:00:00.000Z')
    )).toBe('newest');
    expect(subject.getCurrentSessionId('my-project')).toBe('newest');

    expect(subject.findNewSessionId('my-project', new Set(['old', 'newer', 'newest']))).toBeNull();
    expect(registry.logger.debug).toHaveBeenCalled();
  });

  it('should validate and resolve session files', async () => {
    const subject = await loadSubject();
    const projectFolder = '/Users/test/.claude/projects/my-project';
    const sessionPath = `${projectFolder}/session_1.jsonl`;

    registry.existsSync.mockImplementation((candidate: string) => (
      candidate === '/Users/test/.claude/projects' ||
      candidate === projectFolder ||
      candidate === sessionPath
    ));

    expect(subject.getSessionFilePath('my-project', 'bad/id')).toBeNull();
    expect(subject.getSessionFilePath('my-project', 'session_1')).toBe(sessionPath);
    expect(registry.logger.warn).toHaveBeenCalled();
  });

  it('should extract, deduplicate and format conversations', async () => {
    const subject = await loadSubject();
    const sessionPath = '/tmp/session.jsonl';

    registry.existsSync.mockImplementation((candidate: string) => candidate === sessionPath);
    registry.readFileSync.mockImplementation(() => [
      JSON.stringify({
        type: 'user',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Question one?' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Short answer' }],
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-01-01T00:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'text', text: 'Question one?' }],
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Longer answer for the same question' }],
        },
      }),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-01-01T01:00:00.000Z',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', text: 'skip me' }],
        },
      }),
      'invalid json',
    ].join('\n'));

    const conversations = subject.extractConversations(sessionPath);

    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toEqual({
      timestamp: '2026-01-01T00:00:00.000Z',
      question: 'Question one?',
      answer: 'Longer answer for the same question',
    });
    expect(subject.formatConversationsForLog(conversations)).toContain('Q: Question one?');
    expect(subject.formatConversationsForLog(conversations, false)).not.toContain('[2026-01-01');
  });

  it('should return an empty list when the session file is missing or unreadable', async () => {
    const subject = await loadSubject();
    registry.existsSync.mockReturnValue(false);

    expect(subject.extractConversations('/tmp/missing.jsonl')).toEqual([]);

    registry.existsSync.mockReturnValue(true);
    registry.readFileSync.mockImplementation(() => {
      throw new Error('EIO');
    });

    expect(subject.extractConversations('/tmp/broken.jsonl')).toEqual([]);
    expect(registry.logger.warn).toHaveBeenCalled();
    expect(registry.logger.error).toHaveBeenCalled();
  });

  it('should extract the last assistant context from tool use and fallback text', async () => {
    const subject = await loadSubject();
    const projectFolder = '/Users/test/.claude/projects/my-project';
    const sessionPath = `${projectFolder}/session_1.jsonl`;

    registry.existsSync.mockImplementation((candidate: string) => (
      candidate === '/Users/test/.claude/projects' ||
      candidate === projectFolder ||
      candidate === sessionPath
    ));
    registry.readFileSync.mockImplementation(() => [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            name: 'AskUserQuestion',
            input: {
              questions: [
                {
                  question: 'Choose one',
                  options: [{ label: 'First' }, { label: 'Second' }],
                },
              ],
            },
          }],
        },
      }),
    ].join('\n'));

    expect(subject.getLastAssistantContext('my-project', 'session_1')).toContain('1. First');

    registry.readFileSync.mockImplementation(() => [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Plain response text' }],
        },
      }),
    ].join('\n'));

    expect(subject.getLastAssistantContext('my-project', 'session_1')).toBe('Plain response text');
    expect(subject.getLastAssistantContext('my-project', 'bad/id')).toBeNull();

    registry.readFileSync.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(subject.getLastAssistantContext('my-project', 'session_1')).toBeNull();
    expect(registry.logger.error).toHaveBeenCalled();
  });

  it('should return null when project folders or indexes are missing', async () => {
    const subject = await loadSubject();
    registry.existsSync.mockReturnValue(false);

    expect(subject.findNewSessionId('missing-project', new Set())).toBeNull();
    expect(subject.getCurrentSessionId('missing-project')).toBeNull();
    expect(subject.getSessionFilePath('missing-project', 'session_1')).toBeNull();
    expect(registry.logger.debug).toHaveBeenCalled();
  });

  it('should return null for empty indexes and format empty conversation lists', async () => {
    const subject = await loadSubject();
    const projectFolder = '/Users/test/.claude/projects/my-project';
    const indexPath = `${projectFolder}/sessions-index.json`;

    registry.existsSync.mockImplementation((candidate: string) => (
      candidate === '/Users/test/.claude/projects' ||
      candidate === projectFolder ||
      candidate === indexPath
    ));
    registry.readFileSync.mockImplementation(() => JSON.stringify({
      version: 1,
      entries: [],
    }));

    expect(subject.findNewSessionId('my-project', new Set())).toBeNull();
    expect(subject.getCurrentSessionId('my-project')).toBeNull();
    expect(subject.formatConversationsForLog([])).toBe('');
  });

  it('should extract tool contexts for bash, file operations and generic tools', async () => {
    const subject = await loadSubject();
    const projectFolder = '/Users/test/.claude/projects/my-project';
    const sessionPath = `${projectFolder}/session_1.jsonl`;

    registry.existsSync.mockImplementation((candidate: string) => (
      candidate === '/Users/test/.claude/projects' ||
      candidate === projectFolder ||
      candidate === sessionPath
    ));

    registry.readFileSync.mockImplementation(() => [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm run test:coverage' } }],
        },
      }),
    ].join('\n'));
    expect(subject.getLastAssistantContext('my-project', 'session_1')).toBe('Bash: npm run test:coverage');

    registry.readFileSync.mockImplementation(() => [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/tmp/out.log' } }],
        },
      }),
    ].join('\n'));
    expect(subject.getLastAssistantContext('my-project', 'session_1')).toBe('Write: /tmp/out.log');

    registry.readFileSync.mockImplementation(() => [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/file.ts' } }],
        },
      }),
    ].join('\n'));
    expect(subject.getLastAssistantContext('my-project', 'session_1')).toBe('Edit: /tmp/file.ts');

    registry.readFileSync.mockImplementation(() => [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/file.ts' } }],
        },
      }),
    ].join('\n'));
    expect(subject.getLastAssistantContext('my-project', 'session_1')).toBe('Read: /tmp/file.ts');

    registry.readFileSync.mockImplementation(() => [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'UnknownTool', input: {} }],
        },
      }),
    ].join('\n'));
    expect(subject.getLastAssistantContext('my-project', 'session_1')).toBe('UnknownTool');
  });

  it('should use string user content, default timestamps and trim long text contexts', async () => {
    const subject = await loadSubject();
    const sessionPath = '/tmp/string-content.jsonl';

    registry.existsSync.mockImplementation((candidate: string) => candidate === sessionPath);
    registry.readFileSync.mockImplementation(() => [
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: 'Question from string content',
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Answer from assistant' }],
        },
      }),
    ].join('\n'));

    const conversations = subject.extractConversations(sessionPath);
    expect(conversations).toHaveLength(1);
    expect(conversations[0].question).toBe('Question from string content');
    expect(conversations[0].timestamp).toMatch(/\d{4}-\d{2}-\d{2}T/);

    const projectFolder = '/Users/test/.claude/projects/my-project';
    const sessionFile = `${projectFolder}/session_1.jsonl`;
    registry.existsSync.mockImplementation((candidate: string) => (
      candidate === '/Users/test/.claude/projects' ||
      candidate === projectFolder ||
      candidate === sessionFile
    ));
    registry.readFileSync.mockImplementation(() => [
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'x'.repeat(250) }],
        },
      }),
    ].join('\n'));

    const context = subject.getLastAssistantContext('my-project', 'session_1');
    expect(context).toHaveLength(203);
    expect(context?.startsWith('...')).toBe(true);
  });
});
