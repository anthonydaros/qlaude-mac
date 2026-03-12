import { EventEmitter } from 'events';
import { join } from 'path';
import { PtyWrapper } from '../../pty-wrapper.js';
import { StateDetector } from '../../state-detector.js';
import { AutoExecutor } from '../../auto-executor.js';
import { QueueManager } from '../../queue-manager.js';
import { ConversationLogger } from '../../utils/conversation-logger.js';
import { TelegramNotifier } from '../../utils/telegram.js';
import { TerminalEmulator } from '../../utils/terminal-emulator.js';
import { compilePatterns } from '../../utils/pattern-compiler.js';
import { loadConfig, ensureConfigDir, QLAUDE_DIR } from '../../utils/config.js';
import { setupPtyLifecycle } from '../../pty-lifecycle.js';
import { setupTelegramBridge } from '../../telegram-bridge.js';
import { ElectronDisplay } from './electron-display.js';
import type { QlaudeConfig } from '../../types/config.js';
import { DEFAULT_CONVERSATION_LOG_CONFIG, DEFAULT_TELEGRAM_CONFIG } from '../../types/config.js';

export type EngineState = 'idle' | 'running' | 'paused' | 'stopped';

export interface EngineManagerEvents {
  pty_data: (data: string) => void;
  state_change: (state: { type: string; timestamp: number }) => void;
  task_status: (status: { id: string; status: string; reason?: string }) => void;
  display_message: (payload: { type: string; message: string }) => void;
  engine_state: (state: EngineState) => void;
  error: (err: Error) => void;
}

export class EngineManager extends EventEmitter {
  private ptyWrapper: PtyWrapper;
  private stateDetector: StateDetector;
  private autoExecutor: AutoExecutor;
  private queueManager: QueueManager;
  private display: ElectronDisplay;
  private terminalEmulator: TerminalEmulator;
  private conversationLogger: ConversationLogger;
  private telegramNotifier: TelegramNotifier;
  private config: QlaudeConfig;
  private engineState: EngineState = 'idle';
  private claudeArgs: string[] = [];
  private disposed = false;

  constructor(
    private workspacePath: string,
    config?: QlaudeConfig
  ) {
    super();

    // Ensure .qlaude/ directory exists for this workspace
    process.chdir(workspacePath);
    ensureConfigDir();

    this.config = config ?? loadConfig();

    this.display = new ElectronDisplay();
    this.display.on('message', (type, message) => {
      this.emit('display_message', { type, message });
    });

    this.ptyWrapper = new PtyWrapper();
    this.stateDetector = new StateDetector({
      idleThresholdMs: this.config.idleThresholdMs,
      requiredStableChecks: this.config.requiredStableChecks,
      patterns: compilePatterns(this.config.patterns),
    });

    this.terminalEmulator = new TerminalEmulator(120, 40);

    const convLogConfig = { ...DEFAULT_CONVERSATION_LOG_CONFIG, ...this.config.conversationLog };
    this.conversationLogger = new ConversationLogger({
      ...convLogConfig,
      filePath: join(workspacePath, QLAUDE_DIR, convLogConfig.filePath),
    });

    const telegramConfig = { ...DEFAULT_TELEGRAM_CONFIG, ...this.config.telegram };
    this.telegramNotifier = new TelegramNotifier(telegramConfig);

    this.queueManager = new QueueManager(join(workspacePath, QLAUDE_DIR, 'queue'));

    this.autoExecutor = new AutoExecutor(
      {
        stateDetector: this.stateDetector,
        queueManager: this.queueManager,
        ptyWrapper: this.ptyWrapper,
        display: this.display,
        getClaudeArgs: () => this.claudeArgs,
        conversationLogger: this.conversationLogger,
        terminalEmulator: this.terminalEmulator,
        telegramNotifier: this.telegramNotifier,
      },
      { enabled: !this.config.startPaused }
    );

    this.setupEventForwarding();
  }

  private setupEventForwarding(): void {
    // Forward PTY output to renderer
    this.ptyWrapper.on('data', (data: string) => {
      this.stateDetector.analyze(data);
      this.terminalEmulator.write(data);
      this.emit('pty_data', data);
    });

    // Forward state changes
    this.stateDetector.on('state_change', (state) => {
      this.emit('state_change', { type: state.type, timestamp: Date.now() });
    });

    // Forward queue events
    this.queueManager.on('item_added', () => {
      this.display.updateStatusBar(this.queueManager.getItems());
    });
    this.queueManager.on('item_removed', () => {
      this.display.updateStatusBar(this.queueManager.getItems());
    });
    this.queueManager.on('queue_reloaded', () => {
      this.display.updateStatusBar(this.queueManager.getItems());
    });
    this.queueManager.on('item_executed', () => {
      this.display.updateStatusBar(this.queueManager.getItems());
    });

    // Setup lifecycle and Telegram bridge
    setupPtyLifecycle({
      ptyWrapper: this.ptyWrapper,
      autoExecutor: this.autoExecutor,
      conversationLogger: this.conversationLogger,
      display: this.display,
      telegramNotifier: this.telegramNotifier,
      queueManager: this.queueManager,
      batchReporter: null,
      cleanup: () => this.dispose(),
      getClaudeArgs: () => this.claudeArgs,
      onExit: (code) => {
        this.setEngineState('stopped');
        this.emit('engine_state', 'stopped');
        if (code !== 0) {
          this.emit('error', new Error(`PTY exited with code ${code}`));
        }
      },
    });

    setupTelegramBridge({
      telegramNotifier: this.telegramNotifier,
      ptyWrapper: this.ptyWrapper,
      autoExecutor: this.autoExecutor,
      stateDetector: this.stateDetector,
      display: this.display,
      queueManager: this.queueManager,
      conversationLogger: this.conversationLogger,
      terminalEmulator: this.terminalEmulator,
      setInputBuffer: () => { /* no-op in Electron context */ },
      cwd: this.workspacePath,
    });
  }

  async start(claudeArgs: string[] = []): Promise<void> {
    if (this.disposed) throw new Error('EngineManager is disposed');

    this.claudeArgs = claudeArgs;
    this.display.setPaused(this.config.startPaused ?? true);

    await this.queueManager.reload();
    this.display.updateStatusBar(this.queueManager.getItems());

    this.ptyWrapper.spawn(this.claudeArgs);
    this.setEngineState('running');
  }

  pause(): void {
    this.autoExecutor.stop();
    this.display.setPaused(true);
    this.setEngineState('paused');
  }

  resume(): void {
    this.autoExecutor.start();
    this.display.setPaused(false);
    this.stateDetector.forceReady();
    this.setEngineState('running');
  }

  stop(): void {
    if (this.ptyWrapper.isRunning()) {
      this.ptyWrapper.kill();
    }
    this.setEngineState('stopped');
  }

  writeTopty(data: string): void {
    this.ptyWrapper.write(data);
  }

  getQueueManager(): QueueManager {
    return this.queueManager;
  }

  getEngineState(): EngineState {
    return this.engineState;
  }

  async reloadQueue(): Promise<void> {
    await this.queueManager.reload();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.ptyWrapper.isRunning()) {
      this.ptyWrapper.kill();
    }
    this.telegramNotifier.stopPolling();
    this.terminalEmulator.dispose();
    this.removeAllListeners();
  }

  private setEngineState(state: EngineState): void {
    this.engineState = state;
    this.emit('engine_state', state);
  }
}
