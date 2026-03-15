import { beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  existsSync: registry.existsSync,
  readFileSync: registry.readFileSync,
  writeFileSync: registry.writeFileSync,
  mkdirSync: registry.mkdirSync,
}));

vi.mock('../../../src/utils/logger.js', () => ({
  logger: registry.logger,
}));

vi.mock('../../../src/utils/config.js', () => ({
  QLAUDE_DIR: '.qlaude',
}));

async function loadSubject() {
  vi.resetModules();
  registry.existsSync.mockReset();
  registry.readFileSync.mockReset();
  registry.writeFileSync.mockReset();
  registry.mkdirSync.mockReset();
  registry.logger.info.mockReset();
  registry.logger.error.mockReset();
  return import('../../../src/utils/session-labels.js');
}

describe('session-labels', () => {
  it('should return empty labels when storage does not exist', async () => {
    const subject = await loadSubject();
    registry.existsSync.mockReturnValue(false);

    expect(subject.readSessionLabels()).toEqual({});
  });

  it('should return empty labels and log when the file is invalid JSON', async () => {
    const subject = await loadSubject();
    registry.existsSync.mockReturnValue(true);
    registry.readFileSync.mockImplementation(() => {
      throw new Error('bad json');
    });

    expect(subject.readSessionLabels()).toEqual({});
    expect(registry.logger.error).toHaveBeenCalled();
  });

  it('should save, overwrite, read and remove labels', async () => {
    const subject = await loadSubject();
    const labels = new Map<string, string>([
      ['/Users/max/Documents/Git/anthonydaros/qlaude-mac/.qlaude/session-labels.json', JSON.stringify({ alpha: 'session-1' })],
    ]);

    registry.existsSync.mockImplementation((candidate: string) => labels.has(candidate));
    registry.readFileSync.mockImplementation((candidate: string) => labels.get(candidate) ?? '');
    registry.writeFileSync.mockImplementation((candidate: string, content: string) => {
      labels.set(candidate, content);
    });

    expect(subject.saveSessionLabel('beta', 'session-2')).toBe(false);
    expect(subject.saveSessionLabel('alpha', 'session-3')).toBe(true);
    expect(subject.getSessionLabel('alpha')).toBe('session-3');
    expect(subject.listSessionLabels()).toEqual({ alpha: 'session-3', beta: 'session-2' });
    expect(subject.removeSessionLabel('beta')).toBe(true);
    expect(subject.removeSessionLabel('missing')).toBe(false);

    expect(registry.logger.info).toHaveBeenCalled();
  });

  it('should create the directory and throw when writing fails', async () => {
    const subject = await loadSubject();
    registry.existsSync.mockReturnValue(false);
    registry.writeFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(() => subject.saveSessionLabel('alpha', 'session-1')).toThrow('disk full');
    expect(registry.mkdirSync).toHaveBeenCalled();
    expect(registry.logger.error).toHaveBeenCalled();
  });
});
