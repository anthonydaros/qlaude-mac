import { beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  logger: {
    debug: vi.fn(),
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
  registry.logger.debug.mockReset();
  registry.logger.error.mockReset();
  return import('../../../src/utils/session-log-offsets.js');
}

describe('session-log-offsets', () => {
  it('should return zero when the offsets file is missing', async () => {
    const subject = await loadSubject();
    registry.existsSync.mockReturnValue(false);

    expect(subject.getSessionLogOffset('session-a')).toBe(0);
  });

  it('should handle invalid JSON gracefully', async () => {
    const subject = await loadSubject();
    registry.existsSync.mockReturnValue(true);
    registry.readFileSync.mockImplementation(() => {
      throw new Error('bad json');
    });

    expect(subject.getSessionLogOffset('session-a')).toBe(0);
    expect(registry.logger.error).toHaveBeenCalled();
  });

  it('should save and remove offsets', async () => {
    const subject = await loadSubject();
    const filePath = '/Users/max/Documents/Git/anthonydaros/qlaude-mac/.qlaude/session-log-offsets.json';
    let content = JSON.stringify({ alpha: 2 });

    registry.existsSync.mockImplementation((candidate: string) => candidate === filePath);
    registry.readFileSync.mockImplementation(() => content);
    registry.writeFileSync.mockImplementation((_candidate: string, next: string) => {
      content = next;
    });

    subject.saveSessionLogOffset('beta', 4);
    expect(subject.getSessionLogOffset('beta')).toBe(4);
    expect(subject.removeSessionLogOffset('beta')).toBe(true);
    expect(subject.removeSessionLogOffset('missing')).toBe(false);
    expect(registry.logger.debug).toHaveBeenCalled();
  });

  it('should log write failures without throwing', async () => {
    const subject = await loadSubject();
    registry.existsSync.mockReturnValue(false);
    registry.writeFileSync.mockImplementation(() => {
      throw new Error('read only');
    });

    expect(() => subject.saveSessionLogOffset('alpha', 1)).not.toThrow();
    expect(registry.mkdirSync).toHaveBeenCalled();
    expect(registry.logger.error).toHaveBeenCalled();
  });
});
