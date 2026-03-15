import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import {
  deleteSessionId,
  getClaudeSettingsPath,
  getSessionIdFilePath,
  installHook,
  isHookInstalled,
  readClaudeSettings,
  readSessionId,
  removeHook,
  writeClaudeSettings,
  writeSessionId,
} from '../../src/utils/hook-setup.js';

vi.mock('os', () => ({
  homedir: () => '/home/test-user',
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

describe('hook-setup safety', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should not overwrite settings when installHook sees invalid JSON', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Invalid JSON');
    });

    expect(() => installHook()).toThrow(/Failed to parse Claude settings/);
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });

  it('should not overwrite settings when removeHook sees invalid JSON', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Invalid JSON');
    });

    expect(() => removeHook()).toThrow(/Failed to parse Claude settings/);
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });

  it('should return false from isHookInstalled when settings JSON is invalid', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Invalid JSON');
    });

    expect(isHookInstalled()).toBe(false);
  });

  it('should throw from readClaudeSettings when settings JSON is invalid', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Invalid JSON');
    });

    expect(() => readClaudeSettings()).toThrow(/Failed to parse Claude settings/);
  });

  it('should expose deterministic settings and session file paths', () => {
    expect(getClaudeSettingsPath()).toBe('/home/test-user/.claude/settings.json');
    expect(getSessionIdFilePath('/repo/app')).toBe('/repo/app/.qlaude/session');
  });

  it('should install the qlaude hook, create directories and avoid duplicate installation', () => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) => candidate === '/home/test-user/.claude/settings.json');
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [{ type: 'command', command: 'other-hook' }],
          },
        ],
      },
    }));

    expect(installHook()).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/home/test-user/.claude/settings.json',
      expect.stringContaining('qlaude-session-hook'),
      { encoding: 'utf-8', mode: 0o600 }
    );

    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [{ type: 'command', command: 'qlaude-session-hook' }],
          },
        ],
      },
    }));
    expect(installHook()).toBe(false);
    expect(isHookInstalled()).toBe(true);
  });

  it('should remove only the qlaude hook and clean up empty SessionStart arrays', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync)
      .mockReturnValueOnce(JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'qlaude-session-hook' }] },
            { hooks: [{ type: 'command', command: 'other-hook' }] },
          ],
        },
      }))
      .mockReturnValueOnce(JSON.stringify({
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: 'qlaude-session-hook' }] },
          ],
        },
      }))
      .mockReturnValueOnce(JSON.stringify({ hooks: {} }));

    expect(removeHook()).toBe(true);
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/home/test-user/.claude/settings.json',
      expect.stringContaining('other-hook'),
      { encoding: 'utf-8', mode: 0o600 }
    );

    expect(removeHook()).toBe(true);
    expect(fs.writeFileSync).toHaveBeenLastCalledWith(
      '/home/test-user/.claude/settings.json',
      JSON.stringify({}, null, 2),
      { encoding: 'utf-8', mode: 0o600 }
    );

    expect(removeHook()).toBe(false);
  });

  it('should write settings and manage session id files safely', () => {
    vi.mocked(fs.existsSync).mockImplementation((candidate) => candidate === '/repo/.qlaude/session');
    vi.mocked(fs.readFileSync).mockImplementation((candidate) => {
      if (candidate === '/repo/.qlaude/session') {
        return 'session-123';
      }
      return JSON.stringify({ hooks: {} });
    });

    writeClaudeSettings({ hooks: {} });
    expect(fs.mkdirSync).toHaveBeenCalledWith('/home/test-user/.claude', { recursive: true });

    expect(readSessionId('/repo')).toBe('session-123');
    vi.mocked(fs.readFileSync).mockImplementation(() => '');
    expect(readSessionId('/repo')).toBeNull();

    expect(() => writeSessionId('bad/id', '/repo')).toThrow('Invalid session ID format');
    writeSessionId('session_123', '/repo');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      '/repo/.qlaude/session',
      'session_123',
      { encoding: 'utf-8', mode: 0o600 }
    );

    deleteSessionId('/repo');
    expect(fs.unlinkSync).toHaveBeenCalledWith('/repo/.qlaude/session');
  });

  it('should return null when reading the session id file fails', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('read failed');
    });

    expect(readSessionId('/repo')).toBeNull();
  });
});
