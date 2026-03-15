import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => {
  const state = {
    answers: [] as string[],
    closeListeners: [] as Array<() => void>,
    sigintHandler: undefined as (() => void) | undefined,
  };

  return {
    state,
    createInterface: vi.fn(() => ({
      question: (_prompt: string, cb: (answer: string) => void) => {
        cb(state.answers.shift() ?? '');
      },
      once: (event: string, listener: () => void) => {
        if (event === 'close') {
          state.closeListeners.push(listener);
        }
      },
      on: (event: string, listener: () => void) => {
        if (event === 'SIGINT') {
          state.sigintHandler = listener;
        }
      },
      close: () => {
        const listeners = [...state.closeListeners];
        state.closeListeners.length = 0;
        for (const listener of listeners) {
          listener();
        }
      },
    })),
  };
});

async function loadSubject() {
  vi.resetModules();
  registry.state.closeListeners.length = 0;
  registry.state.sigintHandler = undefined;

  vi.doMock('readline', () => ({
    createInterface: registry.createInterface,
  }));

  return import('../../src/utils/setup-wizard.js');
}

function createFetchResponse(payload: unknown) {
  return {
    json: async () => payload,
  };
}

describe('setup-wizard run flow', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('should skip telegram setup when the user declines immediately', async () => {
    registry.state.answers = ['n'];
    const { runSetupWizard } = await loadSubject();

    await expect(runSetupWizard()).resolves.toEqual({});
    expect(console.log).toHaveBeenCalledWith('Telegram can be configured later in ~/.qlaude/telegram.json.\n');
  });

  it('should stop after an invalid token when the user chooses not to retry', async () => {
    registry.state.answers = ['y', 'bad-token', 'n'];
    vi.mocked(fetch).mockResolvedValue(createFetchResponse({
      ok: false,
    }) as Response);

    const { runSetupWizard } = await loadSubject();

    await expect(runSetupWizard()).resolves.toEqual({});
    expect(console.log).toHaveBeenCalledWith('✗ Invalid token');
    expect(console.log).toHaveBeenCalledWith('Telegram can be configured later in ~/.qlaude/telegram.json.\n');
  });

  it('should return telegram credentials when token validation and chat detection succeed', async () => {
    registry.state.answers = ['y', '123:ABC'];
    vi.mocked(fetch)
      .mockResolvedValueOnce(createFetchResponse({
        ok: true,
        result: { username: 'test_bot' },
      }) as Response)
      .mockResolvedValueOnce(createFetchResponse({
        ok: true,
        result: [{ message: { chat: { id: 777 } } }],
      }) as Response);

    const { runSetupWizard } = await loadSubject();

    await expect(runSetupWizard()).resolves.toEqual({
      telegram: {
        enabled: true,
        botToken: '123:ABC',
        chatId: '777',
      },
    });
    expect(console.log).toHaveBeenCalledWith('✓ Bot: @test_bot');
    expect(console.log).toHaveBeenCalledWith('✓ Chat ID: 777');
  });

  it('should poll for chat updates until a chat id is found', async () => {
    vi.useFakeTimers();
    registry.state.answers = ['y', '123:ABC'];
    vi.mocked(fetch)
      .mockResolvedValueOnce(createFetchResponse({
        ok: true,
        result: { username: 'poll_bot' },
      }) as Response)
      .mockResolvedValueOnce(createFetchResponse({
        ok: true,
        result: [],
      }) as Response)
      .mockResolvedValueOnce(createFetchResponse({
        ok: true,
        result: [],
      }) as Response)
      .mockResolvedValueOnce(createFetchResponse({
        ok: true,
        result: [{ my_chat_member: { chat: { id: 909 } } }],
      }) as Response);

    const { runSetupWizard } = await loadSubject();
    const resultPromise = runSetupWizard();

    await vi.advanceTimersByTimeAsync(4000);

    await expect(resultPromise).resolves.toEqual({
      telegram: {
        enabled: true,
        botToken: '123:ABC',
        chatId: '909',
      },
    });
    expect(console.log).toHaveBeenCalledWith(
      'Open Telegram and send /start or any message to @poll_bot\n  Waiting for message... (Ctrl+C to cancel)'
    );
  });
});
