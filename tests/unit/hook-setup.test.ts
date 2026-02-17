import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { installHook, removeHook, isHookInstalled, readClaudeSettings } from '../../src/utils/hook-setup.js';

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
});
