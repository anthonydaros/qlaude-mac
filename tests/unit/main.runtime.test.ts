import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createDefaultConfig() {
  return {
    startPaused: true,
    idleThresholdMs: 1000,
    requiredStableChecks: 3,
    conversationLog: {
      enabled: false,
      filePath: 'conversation.log',
      timestamps: true,
    },
    telegram: {
      enabled: false,
      botToken: '',
      chatId: '',
      confirmDelayMs: 30000,
    },
    patterns: undefined,
    logLevel: undefined,
    logFile: undefined,
  };
}

const registry = vi.hoisted(() => ({
  ensureConfigDir: vi.fn(),
  isFirstRun: vi.fn(() => false),
  loadConfig: vi.fn(() => createDefaultConfig()),
  reconfigureLogger: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  runSetupWizard: vi.fn(),
  updateGlobalTelegramConfig: vi.fn(),
  updateProjectTelegramConfig: vi.fn(),
  compilePatterns: vi.fn(() => ({ compiled: true })),
  setupPtyLifecycle: vi.fn(),
  setupTelegramBridge: vi.fn(),
  createCommandHandler: vi.fn(() => vi.fn(async () => undefined)),
  toUserFriendlyMessage: vi.fn(() => 'friendly error'),
  cleanupFactory: vi.fn(() => vi.fn()),
  batchReports: [] as any[],
  ptyInstances: [] as any[],
  queueManagers: [] as any[],
  displays: [] as any[],
  stateDetectors: [] as any[],
  autoExecutors: [] as any[],
  conversationLoggers: [] as any[],
  telegramNotifiers: [] as any[],
  terminalEmulators: [] as any[],
}));

class MockPtyWrapper extends EventEmitter {
  write = vi.fn();
  resize = vi.fn();
  spawn = vi.fn();
  restart = vi.fn();
  kill = vi.fn();
  isRunning = vi.fn(() => true);

  constructor() {
    super();
    registry.ptyInstances.push(this);
  }
}

class MockQueueManager extends EventEmitter {
  items = [{ prompt: 'queued item' }];
  reload = vi.fn(async () => ({ fileFound: true, itemCount: this.items.length, skippedLines: 0 }));
  getItems = vi.fn(() => this.items);
  getLength = vi.fn(() => this.items.length);
  addItem = vi.fn(async () => undefined);
  removeLastItem = vi.fn(async () => null);

  constructor(public queuePath: string) {
    super();
    registry.queueManagers.push(this);
  }
}

class MockDisplay {
  updateStatusBar = vi.fn();
  showMessage = vi.fn();
  setPaused = vi.fn();
  clear = vi.fn();
  toggle = vi.fn(() => true);

  constructor() {
    registry.displays.push(this);
  }
}

class MockStateDetector extends EventEmitter {
  analyze = vi.fn();
  reset = vi.fn();
  forceReady = vi.fn();
  setScreenContentProvider = vi.fn();
  getState = vi.fn(() => ({ type: 'READY', metadata: {} }));

  constructor(public options: unknown) {
    super();
    registry.stateDetectors.push(this);
  }
}

class MockAutoExecutor extends EventEmitter {
  start = vi.fn();
  stop = vi.fn();
  isEnabled = vi.fn(() => true);
  hasPendingSessionLoad = vi.fn(() => false);
  handlePtyExitDuringSessionLoad = vi.fn(async () => undefined);
  isQueueActive = vi.fn(() => false);
  handlePtyCrashRecovery = vi.fn(async () => false);

  constructor(public deps: unknown, public options: unknown) {
    super();
    registry.autoExecutors.push(this);
  }
}

class MockConversationLogger {
  logQueueStarted = vi.fn();
  logQueueCompleted = vi.fn();
  logQueueItem = vi.fn();
  logNewSessionStarting = vi.fn();
  refreshSessionId = vi.fn();
  getCurrentSessionId = vi.fn(() => 'session-a');

  constructor(public config: unknown) {
    registry.conversationLoggers.push(this);
  }
}

class MockTelegramNotifier extends EventEmitter {
  startPolling = vi.fn();
  stopPolling = vi.fn();
  isEnabled = vi.fn(() => false);
  notify = vi.fn();
  getInstanceId = vi.fn(() => 'instance-1');

  constructor(public config: unknown) {
    super();
    registry.telegramNotifiers.push(this);
  }
}

class MockTerminalEmulator {
  clear = vi.fn();
  write = vi.fn();
  resize = vi.fn();
  getLastLines = vi.fn(() => ['screen line']);

  constructor(public cols: number, public rows: number) {
    registry.terminalEmulators.push(this);
  }
}

class MockBatchReporter {
  start = vi.fn();
  recordItemExecuted = vi.fn();
  writeReport = vi.fn(() => '/tmp/batch-report.json');

  constructor(public queueFile?: string) {
    registry.batchReports.push(this);
  }
}

class MockInput extends EventEmitter {
  isTTY = true;
  resume = vi.fn();
  setRawMode = vi.fn();
}

class MockOutput extends EventEmitter {
  write = vi.fn(() => true);
  columns = 120;
  rows = 40;
}

async function flushAsyncEvents(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createRuntime(overrides: Partial<any> = {}) {
  const events = new Map<string, (...args: any[]) => void>();
  const stdin = new MockInput();
  const stdout = new MockOutput();
  const stderr = { write: vi.fn(() => true) };

  return {
    stdin,
    stdout,
    stderr,
    events,
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      events.set(event, handler);
    }),
    exit: vi.fn((code: number) => {
      throw Object.assign(new Error(`exit:${code}`), { code });
    }),
    wait: vi.fn(async () => undefined),
    cwd: vi.fn(() => '/repo'),
    readFileSync: vi.fn(() => 'queued prompt'),
    writeFileSync: vi.fn(),
    ...overrides,
  };
}

async function loadSubject() {
  vi.resetModules();
  vi.clearAllMocks();
  registry.batchReports.length = 0;
  registry.ptyInstances.length = 0;
  registry.queueManagers.length = 0;
  registry.displays.length = 0;
  registry.stateDetectors.length = 0;
  registry.autoExecutors.length = 0;
  registry.conversationLoggers.length = 0;
  registry.telegramNotifiers.length = 0;
  registry.terminalEmulators.length = 0;
  process.env.QLAUDE_DISABLE_AUTORUN = '1';

  vi.doMock('fs', () => ({
    readFileSync: vi.fn((...args: unknown[]) => registry.loadConfig(...args)),
    writeFileSync: vi.fn(),
  }));

  vi.doMock('../../src/utils/config.js', () => ({
    ensureConfigDir: registry.ensureConfigDir,
    isFirstRun: registry.isFirstRun,
    loadConfig: registry.loadConfig,
    QLAUDE_DIR: '.qlaude',
  }));

  vi.doMock('../../src/utils/logger.js', () => ({
    logger: registry.logger,
    reconfigureLogger: registry.reconfigureLogger,
  }));

  vi.doMock('../../src/utils/setup-wizard.js', () => ({
    runSetupWizard: registry.runSetupWizard,
    updateGlobalTelegramConfig: registry.updateGlobalTelegramConfig,
    updateProjectTelegramConfig: registry.updateProjectTelegramConfig,
  }));

  vi.doMock('../../src/pty-wrapper.js', () => ({
    PtyWrapper: MockPtyWrapper,
  }));

  vi.doMock('../../src/queue-manager.js', () => ({
    QueueManager: MockQueueManager,
  }));

  vi.doMock('../../src/display.js', () => ({
    Display: MockDisplay,
  }));

  vi.doMock('../../src/state-detector.js', () => ({
    StateDetector: MockStateDetector,
  }));

  vi.doMock('../../src/auto-executor.js', () => ({
    AutoExecutor: MockAutoExecutor,
  }));

  vi.doMock('../../src/utils/conversation-logger.js', () => ({
    ConversationLogger: MockConversationLogger,
  }));

  vi.doMock('../../src/utils/telegram.js', () => ({
    TelegramNotifier: MockTelegramNotifier,
  }));

  vi.doMock('../../src/utils/terminal-emulator.js', () => ({
    TerminalEmulator: MockTerminalEmulator,
  }));

  vi.doMock('../../src/utils/batch-report.js', () => ({
    BatchReporter: MockBatchReporter,
  }));

  vi.doMock('../../src/utils/pattern-compiler.js', () => ({
    compilePatterns: registry.compilePatterns,
  }));

  vi.doMock('../../src/utils/cleanup.js', () => ({
    createCleanup: registry.cleanupFactory,
  }));

  vi.doMock('../../src/command-handler.js', () => ({
    createCommandHandler: registry.createCommandHandler,
  }));

  vi.doMock('../../src/telegram-bridge.js', () => ({
    setupTelegramBridge: registry.setupTelegramBridge,
  }));

  vi.doMock('../../src/pty-lifecycle.js', () => ({
    setupPtyLifecycle: registry.setupPtyLifecycle,
  }));

  vi.doMock('../../src/utils/error-messages.js', () => ({
    toUserFriendlyMessage: registry.toUserFriendlyMessage,
  }));

  vi.doMock('../../src/utils/debounce.js', () => ({
    debounce: <T extends (...args: any[]) => any>(fn: T) => fn,
  }));

  return import('../../src/main.js');
}

beforeEach(() => {
  registry.isFirstRun.mockReturnValue(false);
  registry.loadConfig.mockImplementation(() => createDefaultConfig());
  registry.compilePatterns.mockImplementation(() => ({ compiled: true }));
  registry.createCommandHandler.mockImplementation(() => vi.fn(async () => undefined));
  registry.toUserFriendlyMessage.mockImplementation(() => 'friendly error');
  registry.cleanupFactory.mockImplementation(() => vi.fn());
});

describe('main runtime helpers', () => {
  beforeEach(() => {
    process.env.QLAUDE_DISABLE_AUTORUN = '1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.QLAUDE_DISABLE_AUTORUN;
  });

  it('should resolve runtime context for first run and apply wizard choices', async () => {
    registry.isFirstRun.mockReturnValue(true);
    registry.runSetupWizard.mockResolvedValue({
      telegram: {
        botToken: 'bot-token',
        chatId: 'chat-id',
      },
    });
    registry.loadConfig.mockReturnValue({
      startPaused: true,
      idleThresholdMs: 1000,
      requiredStableChecks: 3,
      conversationLog: {
        enabled: true,
        filePath: 'conversation.log',
        timestamps: true,
      },
      telegram: {
        enabled: false,
        botToken: 'secret',
        chatId: 'room',
        confirmDelayMs: 30000,
      },
      patterns: { selectionPrompt: { enabled: true } },
      logLevel: 'info',
      logFile: 'debug.log',
    });

    const runtime = createRuntime();
    const { resolveRuntimeContext } = await loadSubject();

    const context = await resolveRuntimeContext({
      args: {
        run: true,
        queueFile: 'queue.txt',
        claudeArgs: ['--model', 'opus'],
      },
      runtime,
    });

    expect(registry.runSetupWizard).toHaveBeenCalled();
    expect(registry.ensureConfigDir).toHaveBeenCalled();
    expect(registry.updateGlobalTelegramConfig).toHaveBeenCalledWith({
      botToken: 'bot-token',
      chatId: 'chat-id',
    });
    expect(registry.updateProjectTelegramConfig).toHaveBeenCalledWith({ enabled: true });
    expect(registry.reconfigureLogger).toHaveBeenCalledWith('/repo/.qlaude/debug.log', 'info');
    expect(context.config.startPaused).toBe(false);
    expect(context.batchMode).toBe(true);
    expect(context.batchReporter).toBeInstanceOf(MockBatchReporter);
    expect(context.resolvedConvLogConfig.filePath).toBe('.qlaude/conversation.log');
  });

  it('should exit when the setup wizard is cancelled', async () => {
    registry.isFirstRun.mockReturnValue(true);
    registry.runSetupWizard.mockResolvedValue(null);

    const runtime = createRuntime();
    const { resolveRuntimeContext } = await loadSubject();

    await expect(resolveRuntimeContext({ runtime })).rejects.toThrow('exit:0');
  });

  it('should resolve runtime context without telegram setup and keep non-batch defaults', async () => {
    registry.isFirstRun.mockReturnValue(true);
    registry.runSetupWizard.mockResolvedValue({});

    const runtime = createRuntime();
    const { resolveRuntimeContext } = await loadSubject();

    const context = await resolveRuntimeContext({
      args: {
        claudeArgs: [],
      },
      runtime,
    });

    expect(registry.ensureConfigDir).toHaveBeenCalled();
    expect(registry.updateGlobalTelegramConfig).toHaveBeenCalledWith({ enabled: false });
    expect(registry.updateProjectTelegramConfig).not.toHaveBeenCalled();
    expect(registry.reconfigureLogger).not.toHaveBeenCalled();
    expect(context.batchMode).toBe(false);
    expect(context.batchReporter).toBeNull();
    expect(context.qlaudeDir).toBe('/repo/.qlaude');
    expect(context.config.startPaused).toBe(true);
  });

  it('should create services with compiled patterns and queue cleanup wiring', async () => {
    const { createRuntimeServices } = await loadSubject();
    const runtime = createRuntime();

    const services = createRuntimeServices({
      qlaudeArgs: { claudeArgs: ['--json'] },
      config: registry.loadConfig(),
      batchMode: false,
      batchReporter: null,
      qlaudeDir: '/repo/.qlaude',
      resolvedConvLogConfig: {
        enabled: true,
        filePath: '.qlaude/conversation.log',
        timestamps: true,
      },
    }, { runtime });

    expect(registry.compilePatterns).toHaveBeenCalledWith(undefined);
    expect(services.queueManager).toBeInstanceOf(MockQueueManager);
    expect(services.autoExecutor).toBeInstanceOf(MockAutoExecutor);
    expect(services.conversationLogger).toBeInstanceOf(MockConversationLogger);
    expect(registry.cleanupFactory).toHaveBeenCalledWith(services.ptyWrapper, services.display, runtime.stdin);
  });

  it('should register process handlers and execute the expected actions', async () => {
    const { registerProcessHandlers } = await loadSubject();
    const runtime = createRuntime();
    const cleanup = vi.fn();
    const services = {
      ptyWrapper: { write: vi.fn() },
      telegramNotifier: { stopPolling: vi.fn() },
      cleanup,
    } as any;

    registerProcessHandlers(services, runtime);

    runtime.events.get('exit')?.();
    runtime.events.get('SIGINT')?.();
    expect(() => runtime.events.get('SIGTERM')?.()).toThrow('exit:0');
    expect(() => runtime.events.get('SIGHUP')?.()).toThrow('exit:0');
    expect(() => runtime.events.get('uncaughtException')?.(new Error('boom'))).toThrow('exit:1');
    expect(() => runtime.events.get('unhandledRejection')?.('nope')).toThrow('exit:1');

    expect(services.telegramNotifier.stopPolling).toHaveBeenCalled();
    expect(services.ptyWrapper.write).toHaveBeenCalledWith('\x03');
    expect(cleanup).toHaveBeenCalled();
  });

  it('should attach terminal handlers for queue commands, resize guards and batch completion', async () => {
    const commandHandler = vi.fn(async () => undefined);
    registry.createCommandHandler.mockReturnValue(commandHandler);

    const { attachTerminalHandlers, createRuntimeServices } = await loadSubject();
    const runtime = createRuntime({
      exit: vi.fn(),
    });
    runtime.stdout.columns = 20;
    runtime.stdout.rows = 5;

    const context = {
      qlaudeArgs: { claudeArgs: [] },
      config: registry.loadConfig(),
      batchMode: true,
      batchReporter: new MockBatchReporter('queue.txt'),
      qlaudeDir: '/repo/.qlaude',
      resolvedConvLogConfig: {
        enabled: true,
        filePath: '.qlaude/conversation.log',
        timestamps: true,
      },
    };
    const services = createRuntimeServices(context, { runtime });
    const originalPtyWrite = services.ptyWrapper.write;

    attachTerminalHandlers(context, services, runtime);

    runtime.stdin.emit('data', Buffer.from(':'));
    runtime.stdin.emit('data', Buffer.from('reload'));
    runtime.stdin.emit('data', Buffer.from('\r'));

    runtime.stdout.emit('resize');
    (services.autoExecutor as MockAutoExecutor).emit('queue_completed');
    await Promise.resolve();
    await Promise.resolve();

    expect(commandHandler).toHaveBeenCalledWith(':reload');
    expect(services.display.updateStatusBar).toHaveBeenCalled();
    expect(services.ptyWrapper.resize).not.toHaveBeenCalled();
    expect(context.batchReporter.writeReport).toHaveBeenCalledWith('completed');
    expect(runtime.exit).toHaveBeenCalledWith(0);
    expect(registry.setupTelegramBridge).toHaveBeenCalled();
  });

  it('should handle selection prompts, multiline input, queue overlay commands and normal terminal input', async () => {
    const commandHandler = vi.fn(async (command: string) => {
      if (command === ':help') {
        createHandlerContext?.setInHelpMode(true);
      }
    });
    let createHandlerContext: any;
    registry.createCommandHandler.mockImplementation((context: any) => {
      createHandlerContext = context;
      return commandHandler;
    });

    const { attachTerminalHandlers, createRuntimeServices } = await loadSubject();
    const runtime = createRuntime({
      exit: vi.fn(),
    });

    const context = {
      qlaudeArgs: { claudeArgs: ['--continue'] },
      config: registry.loadConfig(),
      batchMode: false,
      batchReporter: null,
      qlaudeDir: '/repo/.qlaude',
      resolvedConvLogConfig: {
        enabled: true,
        filePath: '.qlaude/conversation.log',
        timestamps: true,
      },
    };
    const services = createRuntimeServices(context, { runtime });
    const originalPtyWrite = services.ptyWrapper.write;

    attachTerminalHandlers(context, services, runtime);

    (services.autoExecutor as MockAutoExecutor).emit('queue_started');
    (services.stateDetector as MockStateDetector).emit('state_change', {
      type: 'SELECTION_PROMPT',
      metadata: {
        bufferSnapshot: '> Option 1\nEnter to select',
        options: ['1'],
      },
    });
    (services.stateDetector as MockStateDetector).emit('state_change', {
      type: 'SELECTION_PROMPT',
      metadata: {
        bufferSnapshot: '> Option 1\nEnter to select',
        options: ['1'],
      },
    });

    expect(services.telegramNotifier.notify).toHaveBeenCalledTimes(1);

    (services.stateDetector as MockStateDetector).getState.mockReturnValue({
      type: 'SELECTION_PROMPT',
      metadata: {},
    });
    services.ptyWrapper.write('\r');
    (services.stateDetector as MockStateDetector).emit('state_change', {
      type: 'SELECTION_PROMPT',
      metadata: {
        bufferSnapshot: '> Option 1\nEnter to select',
        options: ['1'],
      },
    });
    expect(services.telegramNotifier.notify).toHaveBeenCalledTimes(2);

    (services.autoExecutor as MockAutoExecutor).emit('session_restart', { prompt: 'new session' });
    expect(services.conversationLogger.logNewSessionStarting).toHaveBeenCalledWith({ prompt: 'new session' });
    expect(services.terminalEmulator.clear).toHaveBeenCalled();
    expect(services.stateDetector.reset).toHaveBeenCalled();

    (services.ptyWrapper as MockPtyWrapper).emit('data', 'rendered output');
    expect(services.stateDetector.analyze).toHaveBeenCalledWith('rendered output');
    expect(services.terminalEmulator.write).toHaveBeenCalledWith('rendered output');

    runtime.stdin.emit('data', Buffer.from(':'));
    runtime.stdin.emit('data', Buffer.from('foo'));
    runtime.stdin.emit('data', Buffer.from('\x7f'));
    runtime.stdin.emit('data', Buffer.from('o'));
    runtime.stdin.emit('data', Buffer.from('\r'));
    await flushAsyncEvents();
    expect(services.display.showMessage).toHaveBeenCalledWith('warning', '[Queue] Unknown command: :foo');

    runtime.stdin.emit('data', Buffer.from(':'));
    runtime.stdin.emit('data', Buffer.from('abc'));
    runtime.stdin.emit('data', Buffer.from('\x15'));
    runtime.stdin.emit('data', Buffer.from('cancel'));
    runtime.stdin.emit('data', Buffer.from('\x1b'));
    expect(services.display.showMessage).toHaveBeenCalledWith('info', '[Queue] Cancelled');

    runtime.stdin.emit('data', Buffer.from(':'));
    runtime.stdin.emit('data', Buffer.from('help'));
    runtime.stdin.emit('data', Buffer.from('\r'));
    await flushAsyncEvents();
    runtime.stdin.emit('data', Buffer.from('x'));
    expect(commandHandler).toHaveBeenCalledWith(':help');
    expect(services.display.updateStatusBar).toHaveBeenCalled();
    expect(services.ptyWrapper.resize).toHaveBeenCalledWith(120, 40);

    runtime.stdin.emit('data', Buffer.from(':('));
    runtime.stdin.emit('data', Buffer.from('\r'));
    runtime.stdin.emit('data', Buffer.from('line one'));
    runtime.stdin.emit('data', Buffer.from('\r'));
    runtime.stdin.emit('data', Buffer.from(':)'));
    runtime.stdin.emit('data', Buffer.from('\r'));
    await flushAsyncEvents();
    expect(services.queueManager.addItem).toHaveBeenCalledWith('line one', {
      isNewSession: false,
      isMultiline: true,
    });
    expect(services.display.showMessage).toHaveBeenCalledWith('success', '[Queue +1] Added multiline (1 lines)');

    services.queueManager.addItem.mockRejectedValueOnce(new Error('queue failed'));
    runtime.stdin.emit('data', Buffer.from(':('));
    runtime.stdin.emit('data', Buffer.from('\r'));
    runtime.stdin.emit('data', Buffer.from('broken line'));
    runtime.stdin.emit('data', Buffer.from('\r'));
    runtime.stdin.emit('data', Buffer.from(':)'));
    runtime.stdin.emit('data', Buffer.from('\r'));
    await flushAsyncEvents();
    expect(services.display.showMessage).toHaveBeenCalledWith('error', '[Queue] Error: Failed to add multiline item');

    runtime.stdin.emit('data', Buffer.from('abc'));
    runtime.stdin.emit('data', Buffer.from('\x7f'));
    runtime.stdin.emit('data', Buffer.from('\x03'));
    runtime.stdin.emit('data', Buffer.from('\x15'));
    runtime.stdin.emit('data', Buffer.from('\x1b[A'));
    runtime.stdin.emit('data', Buffer.from('\r'));
    expect(originalPtyWrite).toHaveBeenCalledWith('\x7f');
    expect(originalPtyWrite).toHaveBeenCalledWith('\x03');
    expect(originalPtyWrite).toHaveBeenCalledWith('\x15');
    expect(originalPtyWrite).toHaveBeenCalledWith('\x1b[A');

    runtime.stdout.emit('resize');
    expect(services.terminalEmulator.resize).toHaveBeenCalledWith(120, 40);
    expect(services.ptyWrapper.resize).toHaveBeenCalledWith(120, 40);
  });

  it('should write failure reports and exit batch mode when a task fails', async () => {
    const { attachTerminalHandlers, createRuntimeServices } = await loadSubject();
    const runtime = createRuntime({
      exit: vi.fn(),
    });

    const context = {
      qlaudeArgs: { claudeArgs: [] },
      config: registry.loadConfig(),
      batchMode: true,
      batchReporter: new MockBatchReporter('queue.txt'),
      qlaudeDir: '/repo/.qlaude',
      resolvedConvLogConfig: {
        enabled: true,
        filePath: '.qlaude/conversation.log',
        timestamps: true,
      },
    };
    const services = createRuntimeServices(context, { runtime });

    attachTerminalHandlers(context, services, runtime);
    (services.autoExecutor as MockAutoExecutor).emit('task_failed', 'fatal error');
    await flushAsyncEvents();

    expect(context.batchReporter.writeReport).toHaveBeenCalledWith('failed', 'fatal error');
    expect(services.cleanup).toHaveBeenCalled();
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });

  it('should copy queue files, spawn the PTY and exit gracefully on queue file errors', async () => {
    const { runCli } = await loadSubject();
    const runtime = createRuntime();
    const context = {
      qlaudeArgs: {
        queueFile: 'queue.txt',
        claudeArgs: ['--json'],
      },
      config: registry.loadConfig(),
      batchMode: false,
      batchReporter: null,
      qlaudeDir: '/repo/.qlaude',
      resolvedConvLogConfig: {
        enabled: false,
        filePath: '.qlaude/conversation.log',
        timestamps: true,
      },
    };
    const services = {
      ptyWrapper: new MockPtyWrapper(),
      queueManager: new MockQueueManager('.qlaude/queue'),
      display: new MockDisplay(),
      stateDetector: new MockStateDetector({}),
      autoExecutor: new MockAutoExecutor({}, {}),
      conversationLogger: new MockConversationLogger({}),
      telegramNotifier: new MockTelegramNotifier({}),
      terminalEmulator: new MockTerminalEmulator(80, 30),
      cleanup: vi.fn(),
    };

    await runCli({ runtime, context, services });

    expect(runtime.readFileSync).toHaveBeenCalledWith(expect.stringContaining('queue.txt'), 'utf-8');
    expect(runtime.writeFileSync).toHaveBeenCalledWith('.qlaude/queue', 'queued prompt', { mode: 384 });
    expect(services.ptyWrapper.spawn).toHaveBeenCalledWith(['--json']);

    runtime.readFileSync.mockImplementationOnce(() => {
      const error = Object.assign(new Error('missing'), { code: 'ENOENT' });
      throw error;
    });

    await expect(runCli({ runtime, context, services })).rejects.toThrow('exit:1');
    expect(runtime.stderr.write).toHaveBeenCalledWith('Error: Queue file not found: queue.txt\n');
  });

  it('should wire queue manager events, skip raw mode on non-tty stdin and keep running services in sync', async () => {
    const { runCli } = await loadSubject();
    const runtime = createRuntime();
    runtime.stdin.isTTY = false;

    const services = {
      ptyWrapper: new MockPtyWrapper(),
      queueManager: new MockQueueManager('.qlaude/queue'),
      display: new MockDisplay(),
      stateDetector: new MockStateDetector({}),
      autoExecutor: new MockAutoExecutor({}, {}),
      conversationLogger: new MockConversationLogger({}),
      telegramNotifier: new MockTelegramNotifier({}),
      terminalEmulator: new MockTerminalEmulator(80, 30),
      cleanup: vi.fn(),
    };

    await runCli({
      runtime,
      context: {
        qlaudeArgs: { claudeArgs: [] },
        config: registry.loadConfig(),
        batchMode: false,
        batchReporter: null,
        qlaudeDir: '/repo/.qlaude',
        resolvedConvLogConfig: {
          enabled: false,
          filePath: '.qlaude/conversation.log',
          timestamps: true,
        },
      },
      services,
    });

    expect(runtime.stdin.resume).toHaveBeenCalled();
    expect(runtime.stdin.setRawMode).not.toHaveBeenCalled();

    services.queueManager.emit('item_added');
    services.queueManager.emit('item_removed');
    services.queueManager.emit('queue_reloaded');
    services.queueManager.emit('item_executed');
    services.queueManager.emit('file_read_error');
    services.queueManager.emit('file_write_error');
    services.queueManager.emit('file_recovered');

    expect(services.display.updateStatusBar).toHaveBeenCalled();
    expect(services.display.showMessage).toHaveBeenCalledWith('warning', '[Queue] File read failed, using in-memory queue');
    expect(services.display.showMessage).toHaveBeenCalledWith('warning', '[Queue] File write failed, changes may be lost');
    expect(services.display.showMessage).toHaveBeenCalledWith('info', '[Queue] File recovered');
  });

  it('should report generic queue file errors and spawn failures while starting telegram polling when enabled', async () => {
    const { runCli } = await loadSubject();
    const runtime = createRuntime();

    const queueErrorServices = {
      ptyWrapper: new MockPtyWrapper(),
      queueManager: new MockQueueManager('.qlaude/queue'),
      display: new MockDisplay(),
      stateDetector: new MockStateDetector({}),
      autoExecutor: new MockAutoExecutor({}, {}),
      conversationLogger: new MockConversationLogger({}),
      telegramNotifier: new MockTelegramNotifier({}),
      terminalEmulator: new MockTerminalEmulator(80, 30),
      cleanup: vi.fn(),
    };

    runtime.readFileSync.mockImplementationOnce(() => {
      throw new Error('permission denied');
    });

    await expect(runCli({
      runtime,
      context: {
        qlaudeArgs: {
          queueFile: 'queue.txt',
          claudeArgs: [],
        },
        config: registry.loadConfig(),
        batchMode: false,
        batchReporter: null,
        qlaudeDir: '/repo/.qlaude',
        resolvedConvLogConfig: {
          enabled: false,
          filePath: '.qlaude/conversation.log',
          timestamps: true,
        },
      },
      services: queueErrorServices,
    })).rejects.toThrow('exit:1');

    expect(runtime.stderr.write).toHaveBeenCalledWith('Error: Cannot read queue file: queue.txt (permission denied)\n');

    const spawnFailureServices = {
      ptyWrapper: new MockPtyWrapper(),
      queueManager: new MockQueueManager('.qlaude/queue'),
      display: new MockDisplay(),
      stateDetector: new MockStateDetector({}),
      autoExecutor: new MockAutoExecutor({}, {}),
      conversationLogger: new MockConversationLogger({}),
      telegramNotifier: new MockTelegramNotifier({}),
      terminalEmulator: new MockTerminalEmulator(80, 30),
      cleanup: vi.fn(),
    };
    spawnFailureServices.telegramNotifier.isEnabled.mockReturnValue(true);
    spawnFailureServices.ptyWrapper.spawn.mockImplementation(() => {
      throw new Error('spawn boom');
    });

    await expect(runCli({
      runtime: createRuntime(),
      context: {
        qlaudeArgs: {
          claudeArgs: ['--dangerously-skip-permissions'],
        },
        config: registry.loadConfig(),
        batchMode: false,
        batchReporter: null,
        qlaudeDir: '/repo/.qlaude',
        resolvedConvLogConfig: {
          enabled: false,
          filePath: '.qlaude/conversation.log',
          timestamps: true,
        },
      },
      services: spawnFailureServices,
    })).rejects.toThrow('exit:1');

    expect(spawnFailureServices.telegramNotifier.startPolling).toHaveBeenCalled();
    expect(spawnFailureServices.cleanup).toHaveBeenCalled();
  });
});
