import { beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
  },
  terminals: [] as FakeTerminal[],
}));

class FakeLine {
  constructor(private text: string) {}

  translateToString(): string {
    return this.text;
  }
}

class FakeTerminal {
  rows: number;
  buffer: { active: any };
  write = vi.fn();
  resize = vi.fn();
  reset = vi.fn();
  dispose = vi.fn();

  constructor(options: { cols: number; rows: number; allowProposedApi: boolean }) {
    this.rows = options.rows;
    this.buffer = {
      active: {
        cursorX: 2,
        cursorY: 1,
        baseY: 0,
        getLine: vi.fn((index: number) => {
          const lines = ['', 'current line', 'tail'];
          const text = lines[index];
          return text === undefined ? undefined : new FakeLine(text);
        }),
      },
    };
    registry.terminals.push(this);
  }
}

vi.mock('@xterm/headless', () => ({
  default: {
    Terminal: FakeTerminal,
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: registry.logger,
}));

async function loadSubject() {
  vi.resetModules();
  registry.terminals.length = 0;
  registry.logger.debug.mockReset();
  registry.logger.warn.mockReset();
  registry.logger.trace.mockReset();
  registry.logger.error.mockReset();
  return import('../../src/utils/terminal-emulator.js');
}

describe('TerminalEmulator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize, write, read cursor positions, resize, clear and dispose', async () => {
    const { TerminalEmulator } = await loadSubject();
    const emulator = new TerminalEmulator(100, 40);
    const term = registry.terminals[0];

    emulator.write('hello');

    expect(term.write).toHaveBeenCalledWith('hello');
    expect(emulator.getCurrentLine()).toBe('current line');
    expect(emulator.getCursorX()).toBe(2);
    expect(emulator.getCursorY()).toBe(1);

    emulator.resize(120, 50);
    emulator.clear();
    emulator.dispose();

    expect(term.resize).toHaveBeenCalledWith(120, 50);
    expect(term.reset).toHaveBeenCalled();
    expect(term.dispose).toHaveBeenCalled();
    expect(registry.logger.debug).toHaveBeenCalled();
    expect(registry.logger.trace).toHaveBeenCalledWith({ cursorY: 1, text: 'current line' }, 'getCurrentLine');
  });

  it('should handle missing buffers and pad viewport lines', async () => {
    const { TerminalEmulator } = await loadSubject();
    const emulator = new TerminalEmulator();
    const term = registry.terminals[0];

    term.buffer.active = null;

    expect(emulator.getCurrentLine()).toBe('');
    expect(emulator.getLastLines(3)).toEqual([]);
    expect(registry.logger.warn).toHaveBeenCalledWith('Terminal buffer not available');
    expect(registry.logger.debug).toHaveBeenCalledWith('getLastLines: buffer not available');

    term.buffer.active = {
      cursorX: 0,
      cursorY: 0,
      baseY: 0,
      getLine: vi.fn((index: number) => {
        const lines = ['top', undefined, 'bottom'];
        const text = lines[index];
        return text === undefined ? undefined : new FakeLine(text);
      }),
    };

    expect(emulator.getLastLines(5)).toEqual(['', '', '', 'top', 'bottom']);
  });

  it('should recover from terminal API errors', async () => {
    const { TerminalEmulator } = await loadSubject();
    const emulator = new TerminalEmulator();
    const term = registry.terminals[0];

    Object.defineProperty(term, 'buffer', {
      get() {
        throw new Error('buffer crashed');
      },
    });

    expect(emulator.getCurrentLine()).toBe('');
    expect(emulator.getLastLines(2)).toEqual([]);
    expect(emulator.getCursorX()).toBe(0);
    expect(emulator.getCursorY()).toBe(0);
    expect(registry.logger.error).toHaveBeenCalled();
  });
});
