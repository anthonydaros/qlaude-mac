import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({
  writeSessionId: vi.fn(),
  isValidSessionId: vi.fn(() => true),
  existsSync: vi.fn(() => true),
}));

const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin');

function setMockStdin(chunks: string[]): void {
  const stdin = {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield Buffer.from(chunk);
      }
    },
  };

  Object.defineProperty(process, 'stdin', {
    configurable: true,
    value: stdin,
  });
}

async function loadSubject() {
  vi.resetModules();
  vi.clearAllMocks();

  vi.doMock('../../src/utils/hook-setup.js', () => ({
    writeSessionId: registry.writeSessionId,
  }));

  vi.doMock('../../src/utils/session-id.js', () => ({
    isValidSessionId: registry.isValidSessionId,
  }));

  vi.doMock('fs', async () => {
    const actual = await vi.importActual<typeof import('fs')>('fs');
    return {
      ...actual,
      existsSync: registry.existsSync,
    };
  });

  return import('../../src/bin/session-hook.js');
}

describe('session-hook bin', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registry.isValidSessionId.mockReturnValue(true);
    registry.existsSync.mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalStdin) {
      Object.defineProperty(process, 'stdin', originalStdin);
    }
  });

  it('should exit successfully when stdin is empty', async () => {
    setMockStdin([]);
    const { run } = await loadSubject();

    await expect(run()).resolves.toBe(0);
    expect(registry.writeSessionId).not.toHaveBeenCalled();
  });

  it('should reject missing session ids', async () => {
    setMockStdin(['{}']);
    const { run } = await loadSubject();

    await expect(run()).resolves.toBe(1);
    expect(console.error).toHaveBeenCalledWith('qlaude-session-hook: No session_id in input');
  });

  it('should reject invalid session ids', async () => {
    registry.isValidSessionId.mockReturnValue(false);
    setMockStdin([JSON.stringify({ session_id: '../bad' })]);
    const { run } = await loadSubject();

    await expect(run()).resolves.toBe(1);
    expect(console.error).toHaveBeenCalledWith('qlaude-session-hook: Invalid session_id format');
  });

  it('should reject invalid cwd values', async () => {
    registry.existsSync.mockReturnValue(false);
    setMockStdin([JSON.stringify({ session_id: 'session-1', cwd: '/tmp/missing' })]);
    const { run } = await loadSubject();

    await expect(run()).resolves.toBe(1);
    expect(console.error).toHaveBeenCalledWith('qlaude-session-hook: Invalid cwd path');
  });

  it('should write the session id using the resolved cwd', async () => {
    setMockStdin([JSON.stringify({ session_id: 'session-1', cwd: '/tmp/project' })]);
    const { run } = await loadSubject();

    await expect(run()).resolves.toBe(0);
    expect(registry.writeSessionId).toHaveBeenCalledWith('session-1', '/tmp/project');
  });

  it('should fall back to process.cwd when cwd is omitted', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue('/workspace/current');
    setMockStdin([JSON.stringify({ session_id: 'session-2' })]);
    const { run } = await loadSubject();

    await expect(run()).resolves.toBe(0);
    expect(registry.writeSessionId).toHaveBeenCalledWith('session-2', '/workspace/current');
  });

  it('should report malformed input as an error', async () => {
    setMockStdin(['{invalid']);
    const { run } = await loadSubject();

    await expect(run()).resolves.toBe(1);
    expect(console.error).toHaveBeenCalledWith('qlaude-session-hook error:', expect.any(Error));
  });
});
