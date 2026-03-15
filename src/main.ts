#!/usr/bin/env node

import path, { isAbsolute } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { PtyWrapper } from './pty-wrapper.js';
import { logger, reconfigureLogger } from './utils/logger.js';
import { parseArgs, type QlaudeArgs } from './utils/cli-args.js';
import { createCleanup } from './utils/cleanup.js';
import { debounce } from './utils/debounce.js';
import { TerminalEmulator } from './utils/terminal-emulator.js';
import { isQueueCommand } from './input-parser.js';
import { QueueManager } from './queue-manager.js';
import { Display } from './display.js';
import { StateDetector } from './state-detector.js';
import { AutoExecutor } from './auto-executor.js';
import { loadConfig, ensureConfigDir, isFirstRun, QLAUDE_DIR } from './utils/config.js';
import { ConversationLogger } from './utils/conversation-logger.js';
import { TelegramNotifier } from './utils/telegram.js';
import { BatchReporter } from './utils/batch-report.js';
import { compilePatterns } from './utils/pattern-compiler.js';
import { createCommandHandler } from './command-handler.js';
import { setupTelegramBridge } from './telegram-bridge.js';
import { setupPtyLifecycle } from './pty-lifecycle.js';
import { toUserFriendlyMessage } from './utils/error-messages.js';
import type { ConversationLogConfig } from './types/config.js';

const STATUS_BAR_HEIGHT = 5;
const STATUS_BAR_DEBOUNCE_MS = 200;
const RESIZE_DEBOUNCE_MS = 100;
const MIN_COLS = 40;
const MIN_ROWS = 10;

type LoadedConfig = ReturnType<typeof loadConfig>;
type ProcessEventName =
  | 'exit'
  | 'SIGINT'
  | 'SIGTERM'
  | 'SIGHUP'
  | 'uncaughtException'
  | 'unhandledRejection';

export interface ProcessRuntime {
  stdin: NodeJS.ReadStream & {
    isTTY?: boolean;
    setRawMode?(mode: boolean): void;
  };
  stdout: NodeJS.WriteStream & {
    columns?: number;
    rows?: number;
  };
  stderr: NodeJS.WriteStream;
  on(event: ProcessEventName, handler: (...args: unknown[]) => void): void;
  exit(code: number): never;
  wait(ms: number): Promise<void>;
  cwd(): string;
  readFileSync(filePath: string, encoding: BufferEncoding): string;
  writeFileSync(filePath: string, data: string, options?: BufferEncoding | { encoding?: BufferEncoding; mode?: number }): void;
}

export interface RuntimeContext {
  qlaudeArgs: QlaudeArgs;
  config: LoadedConfig;
  batchMode: boolean;
  batchReporter: BatchReporter | null;
  qlaudeDir: string;
  resolvedConvLogConfig: ConversationLogConfig;
}

export interface RuntimeServices {
  ptyWrapper: PtyWrapper;
  queueManager: QueueManager;
  display: Display;
  stateDetector: StateDetector;
  autoExecutor: AutoExecutor;
  conversationLogger: ConversationLogger;
  telegramNotifier: TelegramNotifier;
  terminalEmulator: TerminalEmulator;
  cleanup: () => void;
}

interface ResolveRuntimeContextOptions {
  args?: QlaudeArgs;
  runtime?: Partial<ProcessRuntime>;
}

interface CreateRuntimeServicesOptions {
  runtime?: Partial<ProcessRuntime>;
  overrides?: Partial<RuntimeServices>;
}

interface RunCliOptions {
  runtime?: Partial<ProcessRuntime>;
  context?: RuntimeContext;
  services?: Partial<RuntimeServices>;
}

function createRuntime(overrides?: Partial<ProcessRuntime>): ProcessRuntime {
  return {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    on: (event, handler) => {
      process.on(event, handler as never);
    },
    exit: (code) => process.exit(code),
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    cwd: () => process.cwd(),
    readFileSync: (filePath, encoding) => readFileSync(filePath, encoding),
    writeFileSync: (filePath, data, options) => writeFileSync(filePath, data, options as never),
    ...overrides,
  };
}

function getTerminalSize(stdout: ProcessRuntime['stdout']): { cols: number; rows: number } {
  return {
    cols: stdout.columns || 80,
    rows: stdout.rows || 30,
  };
}

function setupTerminal(stdin: ProcessRuntime['stdin']): void {
  if (stdin.isTTY && stdin.setRawMode) {
    stdin.setRawMode(true);
  }
  stdin.resume();
}

function assertSupportedPlatform(): void {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') {
    process.stderr.write(
      `qlaude requires macOS on Apple Silicon (darwin/arm64).\nCurrent: ${process.platform}/${process.arch}\n`
    );
    process.exit(1);
  }
}

function registerQueueManagerHandlers(services: RuntimeServices): void {
  const { queueManager, display } = services;

  queueManager.on('item_added', () => {
    display.updateStatusBar(queueManager.getItems());
  });

  queueManager.on('item_removed', () => {
    display.updateStatusBar(queueManager.getItems());
  });

  queueManager.on('queue_reloaded', () => {
    display.updateStatusBar(queueManager.getItems());
  });

  queueManager.on('item_executed', () => {
    display.updateStatusBar(queueManager.getItems());
  });

  queueManager.on('file_read_error', () => {
    display.showMessage('warning', '[Queue] File read failed, using in-memory queue');
  });

  queueManager.on('file_write_error', () => {
    display.showMessage('warning', '[Queue] File write failed, changes may be lost');
  });

  queueManager.on('file_recovered', () => {
    display.showMessage('info', '[Queue] File recovered');
  });
}

export async function resolveRuntimeContext(
  options: ResolveRuntimeContextOptions = {}
): Promise<RuntimeContext> {
  const runtime = createRuntime(options.runtime);
  const qlaudeArgs = options.args ?? parseArgs();

  if (isFirstRun() && runtime.stdin.isTTY) {
    const { runSetupWizard, updateGlobalTelegramConfig, updateProjectTelegramConfig } = await import('./utils/setup-wizard.js');
    const wizardResult = await runSetupWizard();
    if (wizardResult) {
      ensureConfigDir();
      if (wizardResult.telegram) {
        const globalFields: Record<string, unknown> = {
          botToken: wizardResult.telegram.botToken,
        };
        if (wizardResult.telegram.chatId) {
          globalFields.chatId = wizardResult.telegram.chatId;
        }
        updateGlobalTelegramConfig(globalFields);
        updateProjectTelegramConfig({ enabled: true });
      } else {
        updateGlobalTelegramConfig({ enabled: false });
      }
    } else {
      runtime.exit(0);
    }
  } else {
    ensureConfigDir();
  }

  const config = loadConfig();

  if (qlaudeArgs.run || qlaudeArgs.queueFile) {
    config.startPaused = false;
  }

  const batchMode = !!qlaudeArgs.run;
  const batchReporter = batchMode ? new BatchReporter(qlaudeArgs.queueFile) : null;
  const qlaudeDir = path.join(runtime.cwd(), QLAUDE_DIR);

  if (config.logFile || config.logLevel) {
    const logFilePath = config.logFile
      ? (isAbsolute(config.logFile) ? config.logFile : path.join(qlaudeDir, config.logFile))
      : undefined;
    reconfigureLogger(logFilePath, config.logLevel);
  }

  const configForLog = {
    ...config,
    telegram: {
      ...config.telegram,
      botToken: config.telegram.botToken ? '***REDACTED***' : '',
      chatId: config.telegram.chatId ? '***REDACTED***' : '',
    },
  };
  logger.info({ config: configForLog }, 'Configuration loaded');

  const resolvedConvLogConfig: ConversationLogConfig = {
    ...config.conversationLog,
    filePath: isAbsolute(config.conversationLog.filePath)
      ? config.conversationLog.filePath
      : path.join(QLAUDE_DIR, config.conversationLog.filePath),
  };

  return {
    qlaudeArgs,
    config,
    batchMode,
    batchReporter,
    qlaudeDir,
    resolvedConvLogConfig,
  };
}

export function createRuntimeServices(
  context: RuntimeContext,
  options: CreateRuntimeServicesOptions = {}
): RuntimeServices {
  const runtime = createRuntime(options.runtime);
  const overrides = options.overrides ?? {};

  const ptyWrapper = overrides.ptyWrapper ?? new PtyWrapper();
  const queueManager = overrides.queueManager ?? new QueueManager(path.join(QLAUDE_DIR, 'queue'));
  const display = overrides.display ?? new Display();
  const stateDetector = overrides.stateDetector ?? new StateDetector({
    idleThresholdMs: context.config.idleThresholdMs,
    requiredStableChecks: context.config.requiredStableChecks,
    patterns: compilePatterns(context.config.patterns),
  });
  const conversationLogger = overrides.conversationLogger ?? new ConversationLogger(context.resolvedConvLogConfig);
  const telegramNotifier = overrides.telegramNotifier ?? new TelegramNotifier(context.config.telegram);
  const { cols, rows } = getTerminalSize(runtime.stdout);
  const terminalEmulator = overrides.terminalEmulator ?? new TerminalEmulator(cols, rows);
  const autoExecutor = overrides.autoExecutor ?? new AutoExecutor({
    stateDetector,
    queueManager,
    ptyWrapper,
    display,
    getClaudeArgs: () => context.qlaudeArgs.claudeArgs,
    conversationLogger,
    terminalEmulator,
    telegramNotifier,
  }, { enabled: !context.config.startPaused });
  const cleanup = overrides.cleanup ?? createCleanup(ptyWrapper, display, runtime.stdin);

  return {
    ptyWrapper,
    queueManager,
    display,
    stateDetector,
    autoExecutor,
    conversationLogger,
    telegramNotifier,
    terminalEmulator,
    cleanup,
  };
}

export function registerProcessHandlers(
  services: RuntimeServices,
  runtimeOverrides?: Partial<ProcessRuntime>
): void {
  const runtime = createRuntime(runtimeOverrides);

  runtime.on('exit', () => {
    services.telegramNotifier.stopPolling();
    services.cleanup();
  });

  runtime.on('SIGINT', () => {
    services.ptyWrapper.write('\x03');
  });

  runtime.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down...');
    services.cleanup();
    runtime.exit(0);
  });

  runtime.on('SIGHUP', () => {
    logger.info('Received SIGHUP, shutting down...');
    services.cleanup();
    runtime.exit(0);
  });

  runtime.on('uncaughtException', (error) => {
    logger.error({ error }, 'Uncaught exception');
    services.cleanup();
    runtime.exit(1);
  });

  runtime.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
    services.cleanup();
    runtime.exit(1);
  });
}

export function attachTerminalHandlers(
  context: RuntimeContext,
  services: RuntimeServices,
  runtimeOverrides?: Partial<ProcessRuntime>
): void {
  const runtime = createRuntime(runtimeOverrides);
  const state = {
    inputBuffer: '',
    multilineBuffer: [] as string[],
    inMultilineMode: false,
    multilineIsNewSession: false,
    inHelpMode: false,
    inQueueInputMode: false,
    queueInputBuffer: '',
    queueExecutionStarted: false,
    lastSelectionSnapshotKey: '',
    scrollRegionInitialized: false,
  };

  const renderQueuePromptOverlay = (): void => {
    if (!state.inQueueInputMode) return;
    const { rows } = getTerminalSize(runtime.stdout);
    runtime.stdout.write(`\x1b7\x1b[${rows};1H\x1b[2K\x1b[33m[Q]\x1b[0m ${state.queueInputBuffer}\x1b8`);
  };

  const renderQueuePrompt = (buffer: string): void => {
    const { rows } = getTerminalSize(runtime.stdout);
    runtime.stdout.write(`\x1b7\x1b[${rows};1H\x1b[2K\x1b[33m[Q]\x1b[0m ${buffer}\x1b8`);
  };

  const clearQueuePrompt = (): void => {
    const { rows } = getTerminalSize(runtime.stdout);
    runtime.stdout.write(`\x1b7\x1b[${rows};1H\x1b[2K\x1b8`);
  };

  const originalPtyWrite = services.ptyWrapper.write.bind(services.ptyWrapper);
  services.ptyWrapper.write = (data: string) => {
    if (services.stateDetector.getState().type === 'SELECTION_PROMPT') {
      if (data === '\r' || /^\d+$/.test(data)) {
        state.lastSelectionSnapshotKey = '';
      }
    }
    originalPtyWrite(data);
  };

  services.stateDetector.on('state_change', (currentState) => {
    logger.debug({ state: currentState }, 'Claude Code state changed');

    if (currentState.type === 'SELECTION_PROMPT' && state.queueExecutionStarted) {
      const snapshot = currentState.metadata?.bufferSnapshot ?? '';
      const snapshotKey = snapshot
        .replace(/[❯>]/g, '')
        .replace(/Enter to select.*$/m, '')
        .replace(/\s+/g, ' ');
      if (snapshotKey && snapshotKey === state.lastSelectionSnapshotKey) {
        logger.debug('Skipping duplicate SELECTION_PROMPT (same screen content)');
        return;
      }
      state.lastSelectionSnapshotKey = snapshotKey;
      services.telegramNotifier.notify('selection_prompt', {
        queueLength: services.queueManager.getLength(),
        options: currentState.metadata?.options,
        context: currentState.metadata?.bufferSnapshot,
      });
    }
  });

  services.autoExecutor.on('queue_started', () => {
    state.queueExecutionStarted = true;
    context.batchReporter?.start();
    services.conversationLogger.logQueueStarted();
  });

  services.autoExecutor.on('queue_completed', async () => {
    state.queueExecutionStarted = false;
    services.conversationLogger.logQueueCompleted();
    if (context.batchReporter) {
      context.batchReporter.writeReport('completed');
      await runtime.wait(2000);
      services.cleanup();
      runtime.exit(0);
    }
  });

  services.autoExecutor.on('executed', () => {
    context.batchReporter?.recordItemExecuted();
    state.inputBuffer = '';
  });

  services.autoExecutor.on('task_failed', async (reason) => {
    if (context.batchReporter) {
      context.batchReporter.writeReport('failed', reason);
      await runtime.wait(2000);
      services.cleanup();
      runtime.exit(1);
    }
  });

  services.autoExecutor.on('session_restart', (item) => {
    services.conversationLogger.logNewSessionStarting(item);
    services.terminalEmulator.clear();
    services.stateDetector.reset();
    state.inputBuffer = '';
  });

  services.stateDetector.setScreenContentProvider(() => services.terminalEmulator.getLastLines(25));

  const reRenderStatusBar = debounce(() => {
    services.display.updateStatusBar(services.queueManager.getItems());
  }, STATUS_BAR_DEBOUNCE_MS);

  services.ptyWrapper.on('data', (data: string) => {
    if (!state.scrollRegionInitialized) {
      state.scrollRegionInitialized = true;
      const { rows } = getTerminalSize(runtime.stdout);
      runtime.stdout.write(`\x1b[${STATUS_BAR_HEIGHT + 1};${rows}r`);
      runtime.stdout.write(`\x1b[${STATUS_BAR_HEIGHT + 1};1H`);
    }

    runtime.stdout.write(data);
    services.stateDetector.analyze(data);
    services.terminalEmulator.write(data);
    reRenderStatusBar();
    renderQueuePromptOverlay();
  });

  const handleCommand = createCommandHandler({
    queueManager: services.queueManager,
    display: services.display,
    autoExecutor: services.autoExecutor,
    ptyWrapper: services.ptyWrapper,
    stateDetector: services.stateDetector,
    conversationLogger: services.conversationLogger,
    terminalEmulator: services.terminalEmulator,
    getClaudeArgs: () => context.qlaudeArgs.claudeArgs,
    setInHelpMode: (value: boolean) => {
      state.inHelpMode = value;
    },
    writeOutput: (text: string) => {
      runtime.stdout.write(text);
    },
  });

  runtime.stdin.on('data', async (chunk: Buffer) => {
    const input = chunk.toString();

    if (state.inHelpMode) {
      state.inHelpMode = false;
      const { cols, rows } = getTerminalSize(runtime.stdout);
      runtime.stdout.write('\x1b[2J\x1b[H');
      services.display.updateStatusBar(services.queueManager.getItems());
      runtime.stdout.write(`\x1b[${STATUS_BAR_HEIGHT + 1};${rows}r`);
      runtime.stdout.write(`\x1b[${STATUS_BAR_HEIGHT + 1};1H`);
      services.ptyWrapper.resize(cols, rows);
      return;
    }

    if (state.inMultilineMode) {
      if (input === '\r' || input === '\n') {
        const currentLine = state.inputBuffer.trim();
        state.inputBuffer = '';

        if (currentLine === ':)') {
          const prompt = state.multilineBuffer.join('\n');
          try {
            await services.queueManager.addItem(prompt, {
              isNewSession: state.multilineIsNewSession,
              isMultiline: true,
            });
            services.display.showMessage('success', `[Queue +1] Added multiline (${state.multilineBuffer.length} lines)`);
          } catch (err) {
            logger.error({ err }, 'Failed to add multiline item to queue');
            services.display.showMessage('error', '[Queue] Error: Failed to add multiline item');
          }

          state.multilineBuffer = [];
          state.inMultilineMode = false;
          state.multilineIsNewSession = false;

          services.ptyWrapper.write('\x15');
          runtime.stdout.write('\r\x1b[2K');
          services.terminalEmulator.clear();
        } else {
          state.multilineBuffer.push(currentLine);
          services.ptyWrapper.write('\x15');
          runtime.stdout.write(`\r\x1b[2K[ML ${state.multilineBuffer.length}] `);
          services.terminalEmulator.clear();
        }
      } else if (input === '\x7f' || input === '\b') {
        state.inputBuffer = state.inputBuffer.slice(0, -1);
        services.ptyWrapper.write(input);
      } else if (input === '\x15') {
        state.inputBuffer = '';
        services.ptyWrapper.write(input);
      } else if (input.startsWith('\x1b')) {
        services.ptyWrapper.write(input);
      } else {
        state.inputBuffer += input;
        services.ptyWrapper.write(input);
      }
      return;
    }

    if (state.inQueueInputMode) {
      if (input === '\r' || input === '\n') {
        const command = state.queueInputBuffer.trim();
        state.queueInputBuffer = '';
        state.inQueueInputMode = false;
        clearQueuePrompt();

        if (command && isQueueCommand(command)) {
          await handleCommand(command);
        } else if (command) {
          services.display.showMessage('warning', `[Queue] Unknown command: ${command}`);
        }
      } else if (input === '\x1b') {
        state.queueInputBuffer = '';
        state.inQueueInputMode = false;
        clearQueuePrompt();
        services.display.showMessage('info', '[Queue] Cancelled');
      } else if (input === '\x7f' || input === '\b') {
        if (state.queueInputBuffer.length > 0) {
          state.queueInputBuffer = state.queueInputBuffer.slice(0, -1);
          renderQueuePrompt(state.queueInputBuffer);
        }
      } else if (input === '\x15') {
        state.queueInputBuffer = '';
        renderQueuePrompt('');
      } else if (!input.startsWith('\x1b')) {
        state.queueInputBuffer += input;
        renderQueuePrompt(state.queueInputBuffer);
      }
      return;
    }

    if (state.inputBuffer === '' && input === ':') {
      state.inQueueInputMode = true;
      state.queueInputBuffer = input;
      services.ptyWrapper.write('\x15');
      renderQueuePrompt(state.queueInputBuffer);
      return;
    }

    if (input === '\r' || input === '\n') {
      const currentLine = state.inputBuffer.trim();
      state.inputBuffer = '';

      logger.debug({ currentLine }, 'Enter pressed, checking line from inputBuffer');

      if (currentLine === ':(') {
        state.inMultilineMode = true;
        state.multilineIsNewSession = false;
        state.multilineBuffer = [];
        services.display.showMessage('info', '[Queue] Multiline mode (end with :))');
        services.ptyWrapper.write('\x15');
        runtime.stdout.write('\r\x1b[2K[ML 0] ');
        services.terminalEmulator.clear();
        return;
      }

      services.ptyWrapper.write('\r');
    } else if (input === '\x7f' || input === '\b') {
      state.inputBuffer = state.inputBuffer.slice(0, -1);
      services.ptyWrapper.write(input);
    } else if (input === '\x03') {
      state.inputBuffer = '';
      services.ptyWrapper.write(input);
    } else if (input === '\x15') {
      state.inputBuffer = '';
      services.ptyWrapper.write(input);
    } else if (input.startsWith('\x1b')) {
      services.ptyWrapper.write(input);
    } else {
      state.inputBuffer += input;
      services.ptyWrapper.write(input);
    }
  });

  const handleResize = debounce(() => {
    const { cols, rows } = getTerminalSize(runtime.stdout);
    services.display.updateStatusBar(services.queueManager.getItems());
    runtime.stdout.write(`\x1b[${STATUS_BAR_HEIGHT + 1};${rows}r`);
    if (cols < MIN_COLS || rows < MIN_ROWS) {
      logger.debug({ newCols: cols, newRows: rows, MIN_COLS, MIN_ROWS }, 'Terminal too small, skipping PTY resize');
      return;
    }
    services.terminalEmulator.resize(cols, rows);
    services.ptyWrapper.resize(cols, rows);
  }, RESIZE_DEBOUNCE_MS);

  runtime.stdout.on('resize', handleResize);

  setupTelegramBridge({
    telegramNotifier: services.telegramNotifier,
    ptyWrapper: services.ptyWrapper,
    autoExecutor: services.autoExecutor,
    stateDetector: services.stateDetector,
    display: services.display,
    queueManager: services.queueManager,
    conversationLogger: services.conversationLogger,
    terminalEmulator: services.terminalEmulator,
    setInputBuffer: (value: string) => {
      state.inputBuffer = value;
    },
  });
}

export async function runCli(options: RunCliOptions = {}): Promise<void> {
  const runtime = createRuntime(options.runtime);
  const context = options.context ?? await resolveRuntimeContext({ runtime });
  const services = createRuntimeServices(context, {
    runtime,
    overrides: options.services,
  });

  if (context.qlaudeArgs.queueFile) {
    const queueFilePath = path.join(QLAUDE_DIR, 'queue');
    try {
      const sourcePath = path.resolve(context.qlaudeArgs.queueFile);
      const content = runtime.readFileSync(sourcePath, 'utf-8');
      runtime.writeFileSync(queueFilePath, content, { mode: 0o600 });
      logger.info({ source: sourcePath, dest: queueFilePath }, 'Queue file copied from CLI argument');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        runtime.stderr.write(`Error: Queue file not found: ${context.qlaudeArgs.queueFile}\n`);
      } else {
        runtime.stderr.write(`Error: Cannot read queue file: ${context.qlaudeArgs.queueFile} (${error.message})\n`);
      }
      runtime.exit(1);
    }
  }

  setupTerminal(runtime.stdin);
  registerQueueManagerHandlers(services);
  services.display.setPaused(context.config.startPaused);

  await services.queueManager.reload();
  services.display.updateStatusBar(services.queueManager.getItems());

  attachTerminalHandlers(context, services, runtime);

  setupPtyLifecycle({
    ptyWrapper: services.ptyWrapper,
    autoExecutor: services.autoExecutor,
    conversationLogger: services.conversationLogger,
    display: services.display,
    telegramNotifier: services.telegramNotifier,
    queueManager: services.queueManager,
    batchReporter: context.batchReporter,
    cleanup: services.cleanup,
    getClaudeArgs: () => context.qlaudeArgs.claudeArgs,
    onExit: (code) => runtime.exit(code),
  });

  registerProcessHandlers(services, runtime);

  if (services.telegramNotifier.isEnabled()) {
    services.telegramNotifier.startPolling();
    logger.info({ instanceId: services.telegramNotifier.getInstanceId() }, 'Telegram bidirectional communication enabled');
  }

  try {
    services.ptyWrapper.spawn(context.qlaudeArgs.claudeArgs);
  } catch (error) {
    runtime.stderr.write(`\nqlaude: ${toUserFriendlyMessage(error)}\n`);
    logger.error({ error }, 'Failed to spawn Claude Code');
    services.cleanup();
    runtime.exit(1);
  }
}

if (process.env.QLAUDE_DISABLE_AUTORUN !== '1') {
  assertSupportedPlatform();

  try {
    await runCli();
  } catch (error) {
    logger.error({ error }, 'Unhandled error in main');
    process.exit(1);
  }
}
