import { describe, it, expect, vi, afterEach } from 'vitest';

const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
const originalArch = Object.getOwnPropertyDescriptor(process, 'arch');

function setProcessProperty(key: 'platform' | 'arch', value: string): void {
  Object.defineProperty(process, key, {
    configurable: true,
    value,
  });
}

describe('main entrypoint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();

    if (originalPlatform) {
      Object.defineProperty(process, 'platform', originalPlatform);
    }
    if (originalArch) {
      Object.defineProperty(process, 'arch', originalArch);
    }
  });

  it('should exit early on unsupported platforms', async () => {
    setProcessProperty('platform', 'linux');
    setProcessProperty('arch', 'x64');

    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const exitError = new Error('process.exit');
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw Object.assign(exitError, { code });
    }) as never);

    await expect(import('../../src/main.js')).rejects.toThrow('process.exit');

    expect(stderrWrite).toHaveBeenCalledWith(
      'qlaude requires macOS on Apple Silicon (darwin/arm64).\nCurrent: linux/x64\n'
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
