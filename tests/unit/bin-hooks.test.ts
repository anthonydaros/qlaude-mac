import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({
  installHook: vi.fn(),
  removeHook: vi.fn(),
  isHookInstalled: vi.fn(),
  getClaudeSettingsPath: vi.fn(() => '/tmp/claude/settings.json'),
  ensureConfigDir: vi.fn(),
  ensureSpawnHelper: vi.fn(),
}));

async function loadSetupHooks() {
  vi.resetModules();
  vi.clearAllMocks();

  vi.doMock('../../src/utils/hook-setup.js', () => ({
    installHook: registry.installHook,
    isHookInstalled: registry.isHookInstalled,
    getClaudeSettingsPath: registry.getClaudeSettingsPath,
  }));

  vi.doMock('../../src/utils/config.js', () => ({
    ensureConfigDir: registry.ensureConfigDir,
  }));

  vi.doMock('../../src/utils/pty-integrity.js', () => ({
    ensureSpawnHelper: registry.ensureSpawnHelper,
  }));

  return import('../../src/bin/setup-hooks.js');
}

async function loadRemoveHooks() {
  vi.resetModules();
  vi.clearAllMocks();

  vi.doMock('../../src/utils/hook-setup.js', () => ({
    removeHook: registry.removeHook,
    isHookInstalled: registry.isHookInstalled,
  }));

  return import('../../src/bin/remove-hooks.js');
}

describe('bin hook scripts', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should install hooks and print setup guidance on first install', async () => {
    registry.ensureConfigDir.mockReturnValue(true);
    registry.isHookInstalled.mockReturnValue(false);
    registry.installHook.mockReturnValue(true);

    const { main } = await loadSetupHooks();
    main();

    expect(registry.ensureSpawnHelper).toHaveBeenCalled();
    expect(registry.ensureConfigDir).toHaveBeenCalled();
    expect(registry.installHook).toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('qlaude: Created .qlaude/ config directory');
    expect(console.log).toHaveBeenCalledWith('qlaude: SessionStart hook installed successfully');
    expect(console.log).toHaveBeenCalledWith('qlaude: Settings file: /tmp/claude/settings.json');
  });

  it('should stop when the hook is already installed', async () => {
    registry.ensureConfigDir.mockReturnValue(false);
    registry.isHookInstalled.mockReturnValue(true);

    const { main } = await loadSetupHooks();
    main();

    expect(registry.installHook).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('qlaude: Config directory already exists');
    expect(console.log).toHaveBeenCalledWith('qlaude: SessionStart hook already installed');
  });

  it('should warn about spawn-helper issues and handle installHook false', async () => {
    registry.ensureSpawnHelper.mockImplementation(() => {
      throw new Error('missing exec bit');
    });
    registry.ensureConfigDir.mockReturnValue(false);
    registry.isHookInstalled.mockReturnValue(false);
    registry.installHook.mockReturnValue(false);

    const { main } = await loadSetupHooks();
    main();

    expect(console.warn).toHaveBeenCalledWith(
      'qlaude: Warning: Could not verify node-pty spawn-helper:',
      'missing exec bit'
    );
    expect(console.log).toHaveBeenCalledWith('qlaude: Hook was already present');
  });

  it('should swallow hook installation failures', async () => {
    registry.ensureConfigDir.mockReturnValue(false);
    registry.isHookInstalled.mockReturnValue(false);
    registry.installHook.mockImplementation(() => {
      throw new Error('write failed');
    });

    const { main } = await loadSetupHooks();
    main();

    expect(console.error).toHaveBeenCalledWith('qlaude: Failed to install hook:', expect.any(Error));
    expect(console.log).toHaveBeenCalledWith(
      'qlaude: You can manually add "qlaude-session-hook" to your Claude Code SessionStart hooks'
    );
  });

  it('should report when there is no hook to remove', async () => {
    registry.isHookInstalled.mockReturnValue(false);

    const { main } = await loadRemoveHooks();
    main();

    expect(registry.removeHook).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('qlaude: SessionStart hook not found, nothing to remove');
  });

  it('should report successful hook removal', async () => {
    registry.isHookInstalled.mockReturnValue(true);
    registry.removeHook.mockReturnValue(true);

    const { main } = await loadRemoveHooks();
    main();

    expect(console.log).toHaveBeenCalledWith('qlaude: SessionStart hook removed successfully');
  });

  it('should report when the hook was already absent at removal time', async () => {
    registry.isHookInstalled.mockReturnValue(true);
    registry.removeHook.mockReturnValue(false);

    const { main } = await loadRemoveHooks();
    main();

    expect(console.log).toHaveBeenCalledWith('qlaude: Hook was not present');
  });

  it('should swallow hook removal failures', async () => {
    registry.isHookInstalled.mockReturnValue(true);
    registry.removeHook.mockImplementation(() => {
      throw new Error('permission denied');
    });

    const { main } = await loadRemoveHooks();
    main();

    expect(console.error).toHaveBeenCalledWith('qlaude: Failed to remove hook:', expect.any(Error));
    expect(console.log).toHaveBeenCalledWith(
      'qlaude: You can manually remove "qlaude-session-hook" from your Claude Code settings'
    );
  });
});
