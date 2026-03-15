import { beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  homedir: '/Users/test',
  cwd: '/workspace/qlaude',
  files: new Map<string, string>(),
  dirs: new Set<string>(),
  failMkdir: false,
}));

vi.mock('fs', () => ({
  existsSync: registry.existsSync,
  readFileSync: registry.readFileSync,
  writeFileSync: registry.writeFileSync,
  mkdirSync: registry.mkdirSync,
  renameSync: registry.renameSync,
}));

vi.mock('os', () => ({
  homedir: () => registry.homedir,
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: registry.logger,
}));

function seedFile(path: string, content: string): void {
  registry.files.set(path, content);
}

function seedDir(path: string): void {
  registry.dirs.add(path);
}

async function loadSubject() {
  vi.resetModules();
  registry.files.clear();
  registry.dirs.clear();
  registry.failMkdir = false;
  registry.existsSync.mockReset();
  registry.readFileSync.mockReset();
  registry.writeFileSync.mockReset();
  registry.mkdirSync.mockReset();
  registry.renameSync.mockReset();
  registry.logger.debug.mockReset();
  registry.logger.info.mockReset();
  registry.logger.warn.mockReset();

  registry.existsSync.mockImplementation((candidate: string) => (
    registry.files.has(candidate) || registry.dirs.has(candidate)
  ));
  registry.readFileSync.mockImplementation((candidate: string) => {
    const content = registry.files.get(candidate);
    if (content === undefined) {
      const error = new Error(`ENOENT: ${candidate}`) as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      throw error;
    }
    return content;
  });
  registry.writeFileSync.mockImplementation((candidate: string, content: string) => {
    registry.files.set(candidate, content);
  });
  registry.mkdirSync.mockImplementation((candidate: string) => {
    if (registry.failMkdir) {
      throw new Error('permission denied');
    }
    registry.dirs.add(candidate);
  });
  registry.renameSync.mockImplementation((from: string, to: string) => {
    const content = registry.files.get(from);
    if (content === undefined) {
      throw new Error('missing source');
    }
    registry.files.delete(from);
    registry.files.set(to, content);
  });

  vi.spyOn(process, 'cwd').mockReturnValue(registry.cwd);
  return import('../../../src/utils/config.js');
}

describe('config utils', () => {
  it('should detect first run and create missing config files', async () => {
    const subject = await loadSubject();
    const cwdDir = `${registry.cwd}/.qlaude`;

    expect(subject.isFirstRun()).toBe(true);
    expect(subject.ensureConfigDir()).toBe(true);
    expect(subject.ensureConfigDir()).toBe(false);

    expect(registry.dirs.has(cwdDir)).toBe(true);
    expect(registry.files.get(`${cwdDir}/config.json`)).toContain('"startPaused": true');
    expect(registry.files.get(`${cwdDir}/patterns.json`)).toBe('{}\n');
    expect(registry.files.get(`${cwdDir}/telegram.json`)).toContain('"enabled": false');
    expect(registry.logger.info).toHaveBeenCalled();

    seedFile('/Users/test/.qlaude/telegram.json', JSON.stringify({ enabled: true }));
    expect(subject.isFirstRun()).toBe(false);
  });

  it('should return false when the config directory cannot be created', async () => {
    const subject = await loadSubject();
    registry.failMkdir = true;

    expect(subject.ensureConfigDir()).toBe(false);
  });

  it('should load defaults and merge global telegram credentials without project config', async () => {
    const subject = await loadSubject();
    seedFile('/Users/test/.qlaude/telegram.json', JSON.stringify({
      botToken: 'global-token',
      chatId: 'global-chat',
      enabled: true,
      confirmDelayMs: 5,
      templates: {
        selection_prompt: 'Prompt template',
      },
    }));

    const config = subject.loadConfig();

    expect(config.startPaused).toBe(true);
    expect(config.telegram.botToken).toBe('global-token');
    expect(config.telegram.chatId).toBe('global-chat');
    expect(config.telegram.enabled).toBe(true);
    expect(config.telegram.confirmDelayMs).toBe(5);
    expect(config.telegram.templates?.selection_prompt).toBe('Prompt template');
    expect(registry.logger.debug).toHaveBeenCalledWith('No .qlaude directory found, using defaults');
  });

  it('should warn about legacy config, migrate old patterns and merge project overrides', async () => {
    const subject = await loadSubject();
    const cwdDir = `${registry.cwd}/.qlaude`;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    seedDir(cwdDir);
    seedFile(`${registry.cwd}/.qlauderc.json`, '{}');
    seedFile('/Users/test/.qlaude/telegram.json', JSON.stringify({
      botToken: 'global-token',
      chatId: 'global-chat',
      enabled: false,
    }));
    seedFile(`${cwdDir}/config.json`, JSON.stringify({
      startPaused: false,
      idleThresholdMs: -1,
      requiredStableChecks: 0,
      logLevel: 'warn',
      logFile: 'debug.log',
      conversationLog: {
        enabled: true,
        filePath: 'project.log',
        timestamps: 'bad',
      },
    }));
    seedFile(`${cwdDir}/patterns.json`, JSON.stringify({
      spinner: { frames: ['x'] },
    }));
    seedFile(`${cwdDir}/telegram.json`, JSON.stringify({
      enabled: true,
      confirmDelayMs: 0,
      templates: {
        queue_completed: 'done',
        invalid: 123,
      },
      language: 'ignored',
    }));

    const config = subject.loadConfig();

    expect(warnSpy).toHaveBeenCalled();
    expect(registry.renameSync).toHaveBeenCalledWith(
      `${cwdDir}/patterns.json`,
      `${cwdDir}/patterns.json.bak`
    );
    expect(registry.files.get(`${cwdDir}/patterns.json`)).toBe('{}\n');
    expect(config.startPaused).toBe(false);
    expect(config.idleThresholdMs).toBe(1000);
    expect(config.requiredStableChecks).toBe(3);
    expect(config.logLevel).toBe('warn');
    expect(config.logFile).toBe('debug.log');
    expect(config.conversationLog.enabled).toBe(true);
    expect(config.conversationLog.filePath).toBe('project.log');
    expect(config.conversationLog.timestamps).toBe(true);
    expect(config.telegram.botToken).toBe('global-token');
    expect(config.telegram.chatId).toBe('global-chat');
    expect(config.telegram.enabled).toBe(true);
    expect(config.telegram.confirmDelayMs).toBe(0);
    expect(config.telegram.templates).toEqual({ queue_completed: 'done' });
    expect(registry.logger.warn).toHaveBeenCalled();
  });

  it('should ignore invalid JSON and invalid pattern structures gracefully', async () => {
    const subject = await loadSubject();
    const cwdDir = `${registry.cwd}/.qlaude`;

    seedDir(cwdDir);
    seedFile(`${cwdDir}/config.json`, '{invalid json');
    seedFile(`${cwdDir}/patterns.json`, JSON.stringify([]));
    seedFile(`${cwdDir}/telegram.json`, JSON.stringify({
      enabled: 'bad',
      botToken: 42,
      chatId: 5,
      confirmDelayMs: -1,
      templates: 'wrong',
    }));

    const config = subject.loadConfig();

    expect(config.startPaused).toBe(true);
    expect(config.patterns).toEqual({});
    expect(config.telegram.enabled).toBe(false);
    expect(config.telegram.botToken).toBe('');
    expect(config.telegram.chatId).toBe('');
    expect(registry.logger.warn).toHaveBeenCalled();
  });

  it('should validate nested config fields and keep only supported pattern entries', async () => {
    const subject = await loadSubject();
    const cwdDir = `${registry.cwd}/.qlaude`;

    seedDir(cwdDir);
    seedFile(`${cwdDir}/config.json`, JSON.stringify({
      startPaused: 'later',
      idleThresholdMs: 0,
      requiredStableChecks: -1,
      logLevel: 'verbose',
      logFile: '',
      conversationLog: {
        enabled: 'yes',
        filePath: '',
        timestamps: 'sometimes',
      },
    }));
    seedFile(`${cwdDir}/patterns.json`, JSON.stringify({
      selectionPrompt: {
        enabled: true,
        patterns: ['pick one', { pattern: '^\\d+$', flags: 'm' }, { pattern: 1 }, false],
      },
      interrupted: {
        patterns: [],
      },
      taskFailure: null,
      textInputKeywords: {
        patterns: ['enter text'],
      },
      optionParse: {
        enabled: true,
        pattern: '^(\\\\d+)$',
        flags: 'i',
      },
      tipFilter: {
        enabled: true,
        keywords: ['tip', 42],
      },
      promptSeparator: {
        enabled: true,
        pattern: '^---$',
        minLength: 2,
      },
    }));
    seedFile(`${cwdDir}/telegram.json`, JSON.stringify({
      enabled: 'yes',
      botToken: 99,
      chatId: true,
      confirmDelayMs: -10,
      templates: {
        queue_started: 'started',
        bad: 7,
      },
    }));

    const config = subject.loadConfig();

    expect(config.startPaused).toBe(true);
    expect(config.idleThresholdMs).toBe(1000);
    expect(config.requiredStableChecks).toBe(3);
    expect(config.logLevel).toBeUndefined();
    expect(config.logFile).toBeUndefined();
    expect(config.conversationLog).toEqual({
      enabled: false,
      filePath: 'conversation.log',
      timestamps: true,
    });
    expect(config.telegram.templates).toEqual({ queue_started: 'started' });
    expect(config.patterns).toEqual({
      selectionPrompt: {
        enabled: true,
        patterns: ['pick one', { pattern: '^\\d+$', flags: 'm' }],
      },
      interrupted: {
        patterns: [],
      },
      textInputKeywords: {
        patterns: ['enter text'],
      },
      optionParse: {
        enabled: true,
        pattern: '^(\\\\d+)$',
        flags: 'i',
      },
      tipFilter: {
        enabled: true,
      },
      promptSeparator: {
        enabled: true,
        pattern: '^---$',
        minLength: 2,
      },
    });
    expect(registry.logger.warn).toHaveBeenCalledWith(
      { value: 'later' },
      'Invalid startPaused value, ignoring'
    );
    expect(registry.logger.warn).toHaveBeenCalledWith(
      { value: 'yes' },
      'Invalid telegram.enabled value, ignoring'
    );
  });

  it('should ignore non-object config payloads while keeping valid global telegram credentials', async () => {
    const subject = await loadSubject();
    const cwdDir = `${registry.cwd}/.qlaude`;

    seedDir(cwdDir);
    seedFile('/Users/test/.qlaude/telegram.json', JSON.stringify({
      enabled: true,
      botToken: 'global-token',
      chatId: 'global-chat',
    }));
    seedFile(`${cwdDir}/config.json`, '42');
    seedFile(`${cwdDir}/patterns.json`, '"invalid"');
    seedFile(`${cwdDir}/telegram.json`, 'null');

    const config = subject.loadConfig();

    expect(config.startPaused).toBe(true);
    expect(config.telegram.botToken).toBe('global-token');
    expect(config.telegram.chatId).toBe('global-chat');
    expect(config.patterns).toBeUndefined();
    expect(registry.logger.warn).toHaveBeenCalledWith(
      { value: 'invalid' },
      'Invalid patterns config, ignoring'
    );
  });
});
