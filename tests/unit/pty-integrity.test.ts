import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist shared mock state so it's available when vi.mock factories run
const { mockResolve } = vi.hoisted(() => ({
  mockResolve: vi.fn<(id: string) => string>().mockReturnValue('/mock/node_modules/node-pty/lib/index.js'),
}));

vi.mock('node:module', () => ({
  createRequire: vi.fn(() => ({ resolve: mockResolve })),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  accessSync: vi.fn(),
  chmodSync: vi.fn(),
  constants: { X_OK: 1 },
}));

import * as fs from 'node:fs';
import { ensureSpawnHelper } from '../../src/utils/pty-integrity.js';

describe('ensureSpawnHelper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockReturnValue('/mock/node_modules/node-pty/lib/index.js');
  });

  it('returns without error when helper exists and is executable', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.accessSync).mockReturnValue(undefined as unknown as void);

    expect(() => ensureSpawnHelper()).not.toThrow();
    expect(fs.chmodSync).not.toHaveBeenCalled();
  });

  it('applies chmod when helper exists but lacks +x, then returns without error', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.accessSync).mockImplementation(() => {
      const err = new Error('EACCES') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });
    vi.mocked(fs.chmodSync).mockReturnValue(undefined as unknown as void);

    expect(() => ensureSpawnHelper()).not.toThrow();
    expect(fs.chmodSync).toHaveBeenCalledWith(
      expect.stringContaining('spawn-helper'),
      0o755
    );
  });

  it('throws when helper exists, lacks +x, and chmod fails', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.accessSync).mockImplementation(() => {
      throw new Error('EACCES');
    });
    vi.mocked(fs.chmodSync).mockImplementation(() => {
      throw new Error('Operation not permitted');
    });

    expect(() => ensureSpawnHelper()).toThrow(/not executable/);
  });

  it('throws with expected path when helper is not found', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    expect(() => ensureSpawnHelper()).toThrow(/spawn-helper not found/);
  });

  it('throws when node-pty cannot be resolved', () => {
    mockResolve.mockImplementation(() => {
      throw new Error("Cannot find module 'node-pty'");
    });

    expect(() => ensureSpawnHelper()).toThrow(/Cannot resolve node-pty/);
  });
});
