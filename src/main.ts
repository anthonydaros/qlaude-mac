#!/usr/bin/env node

import path, { isAbsolute } from 'path';
import { readFileSync, writeFileSync } from 'fs';
import { PtyWrapper } from './pty-wrapper.js';
import { logger, reconfigureLogger } from './utils/logger.js';
import { parseArgs } from './utils/cli-args.js';
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

// Platform guard: macOS Apple Silicon only
if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  process.stderr.write(`qlaude requires macOS on Apple Silicon (darwin/arm64).\nCurrent: ${process.platform}/${process.arch}\n`);
  process.exit(1);
}

// Parse qlaude-specific CLI arguments before anything else
const qlaudeArgs = parseArgs();

// Run setup wizard on first run, then create config files
if (isFirstRun() && process.stdin.isTTY) {
  const { runSetupWizard, updateGlobalTelegramConfig, updateProjectTelegramConfig } = await import('./utils/setup-wizard.js');
  const wizardResult = await runSetupWizard();
  if (wizardResult) {
    // Wizard completed — create config files and apply wizard choices
    ensureConfigDir();
    // Save credentials to global ~/.qlaude/telegram.json
    if (wizardResult.telegram) {
      const globalFields: Record<string, unknown> = {
        botToken: wizardResult.telegram.botToken,
      };
      if (wizardResult.telegram.chatId) {
        globalFields.chatId = wizardResult.telegram.chatId;
      }
      updateGlobalTelegramConfig(globalFields);
      // Enable telegram in the project config
      updateProjectTelegramConfig({ enabled: true });
    } else {
      // Telegram skipped — write marker so wizard doesn't re-run next boot
      updateGlobalTelegramConfig({ enabled: false });
    }
  } else {
    // Wizard cancelled — exit without creating config, re-runs next time
    process.exit(0);
  }
} else {
  ensureConfigDir();
}

// Load configuration
const config = loadConfig();

// Override startPaused if --run flag is set or queue file is provided
if (qlaudeArgs.run || qlaudeArgs.queueFile) {
  config.startPaused = false;
}

// Batch mode: auto-exit on queue completion with report
const batchMode = !!qlaudeArgs.run;
const batchReporter = batchMode ? new BatchReporter(qlaudeArgs.queueFile) : null;

// Resolve log file paths relative to .qlaude/ directory
const qlaudeDir = path.join(process.cwd(), QLAUDE_DIR);

// Reconfigure logger with config settings (before any other logging)
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

const ptyWrapper = new PtyWrapper();
const queueManager = new QueueManager(path.join(QLAUDE_DIR, 'queue'));
const display = new Display();
const stateDetector = new StateDetector({
  idleThresholdMs: config.idleThresholdMs,
  requiredStableChecks: config.requiredStableChecks,
  patterns: compilePatterns(config.patterns),
});
// Resolve conversationLog filePath relative to .qlaude/ directory
const resolvedConvLogConfig = {
  ...config.conversationLog,
  filePath: isAbsolute(config.conversationLog.filePath)
    ? config.conversationLog.filePath
    : path.join(QLAUDE_DIR, config.conversationLog.filePath),
};
const conversationLogger = new ConversationLogger(resolvedConvLogConfig);
const telegramNotifier = new TelegramNotifier(config.telegram);

// Terminal emulator to track current input line from PTY output (initialized with default size)
const terminalEmulator = new TerminalEmulator(process.stdout.columns || 80, process.stdout.rows || 30);

// claudeArgs will be set in main() and accessed via callback
let claudeArgs: string[] = [];

// Multiline input buffer state
let multilineBuffer: string[] = [];
let inMultilineMode = false;
let multilineIsNewSession = false;

// Direct input buffer for reliable command detection
let inputBuffer = '';

// Help screen mode — any keypress clears and returns to normal
let inHelpMode = false;

// Queue input mode state
let inQueueInputMode = false;
let queueInputBuffer = '';

// AutoExecutor subscribes to stateDetector events in constructor
const autoExecutor = new AutoExecutor({
  stateDetector,
  queueManager,
  ptyWrapper,
  display,
  getClaudeArgs: () => claudeArgs,
  conversationLogger,
  terminalEmulator,
  telegramNotifier,
}, { enabled: !config.startPaused });
const cleanup = createCleanup(ptyWrapper, display);

function setupTerminal(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
}


const STATUS_BAR_HEIGHT = 5;

async function main(): Promise<void> {
  claudeArgs = qlaudeArgs.claudeArgs;

  // Copy queue file if --queue or positional file arg was provided
  if (qlaudeArgs.queueFile) {
    const queueFilePath = path.join(QLAUDE_DIR, 'queue');
    try {
      const sourcePath = path.resolve(qlaudeArgs.queueFile);
      const content = readFileSync(sourcePath, 'utf-8');
      writeFileSync(queueFilePath, content, { mode: 0o600 });
      logger.info({ source: sourcePath, dest: queueFilePath }, 'Queue file copied from CLI argument');
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === 'ENOENT') {
        process.stderr.write(`Error: Queue file not found: ${qlaudeArgs.queueFile}\n`);
      } else {
        process.stderr.write(`Error: Cannot read queue file: ${qlaudeArgs.queueFile} (${error.message})\n`);
      }
      process.exit(1);
    }
  }

  setupTerminal();

  // Subscribe to QueueManager events for status bar updates
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

  // Subscribe to QueueManager file I/O error events
  queueManager.on('file_read_error', () => {
    display.showMessage('warning', '[Queue] File read failed, using in-memory queue');
  });

  queueManager.on('file_write_error', () => {
    display.showMessage('warning', '[Queue] File write failed, changes may be lost');
  });

  queueManager.on('file_recovered', () => {
    display.showMessage('info', '[Queue] File recovered');
  });

  // Set initial paused state
  display.setPaused(config.startPaused);

  // Load queue file and render initial status bar BEFORE PTY spawn
  // This ensures scroll region is set correctly before Claude Code starts outputting
  await queueManager.reload();
  display.updateStatusBar(queueManager.getItems());

  // Subscribe to StateDetector events for logging and buffer management
  // Deduplicate SELECTION_PROMPT notifications by comparing screen content
  // Cursor movement only changes ❯/> position; normalize these before comparison
  let lastSelectionSnapshotKey = '';

  // Track queue execution state to suppress notifications before queue starts
  let queueExecutionStarted = false;

  // Reset dedup when selection input (Enter or digit) is sent to PTY during SELECTION_PROMPT
  const originalPtyWrite = ptyWrapper.write.bind(ptyWrapper);
  ptyWrapper.write = (data: string) => {
    if (stateDetector.getState().type === 'SELECTION_PROMPT') {
      if (data === '\r' || /^\d+$/.test(data)) {
        lastSelectionSnapshotKey = '';
      }
    }
    originalPtyWrite(data);
  };

  stateDetector.on('state_change', (state) => {
    logger.debug({ state }, 'Claude Code state changed');

    // Send Telegram notifications for SELECTION_PROMPT (independent of autoExecutor.enabled)
    // Note: INTERRUPTED notifications removed due to high false positive rate from code content
    // Skip notifications before queue starts (e.g. initial Claude Code setup prompts)
    if (state.type === 'SELECTION_PROMPT' && queueExecutionStarted) {
      const snapshot = state.metadata?.bufferSnapshot ?? '';
      // Strip cursor indicators and navigation footer so cursor movement doesn't change the key
      // Footer varies: "Enter to select · ↑/↓ to navigate · ctrl+g to edit in Notepad · Esc to cancel"
      const snapshotKey = snapshot
        .replace(/[❯>]/g, '')
        .replace(/Enter to select.*$/m, '')
        .replace(/\s+/g, ' ');
      if (snapshotKey && snapshotKey === lastSelectionSnapshotKey) {
        logger.debug('Skipping duplicate SELECTION_PROMPT (same screen content)');
        return;
      }
      lastSelectionSnapshotKey = snapshotKey;
      const options = state.metadata?.options;
      const context = state.metadata?.bufferSnapshot;
      telegramNotifier.notify('selection_prompt', {
        queueLength: queueManager.getLength(),
        options,
        context,
      });
    }
  });

  // Subscribe to AutoExecutor events for conversation logging
  autoExecutor.on('queue_started', () => {
    queueExecutionStarted = true;
    batchReporter?.start();
    conversationLogger.logQueueStarted();
  });

  autoExecutor.on('queue_completed', async () => {
    queueExecutionStarted = false;
    conversationLogger.logQueueCompleted();
    if (batchReporter) {
      batchReporter.writeReport('completed');
      // Wait for pending Telegram notification to be sent before exiting
      await new Promise((resolve) => setTimeout(resolve, 2000));
      cleanup();
      process.exit(0);
    }
  });

  autoExecutor.on('executed', () => {
    batchReporter?.recordItemExecuted();
    // Clear inputBuffer: auto-executed prompt replaces any user-typed partial input
    inputBuffer = '';
  });

  autoExecutor.on('task_failed', async (reason) => {
    if (batchReporter) {
      batchReporter.writeReport('failed', reason);
      await new Promise((resolve) => setTimeout(resolve, 2000));
      cleanup();
      process.exit(1);
    }
  });

  autoExecutor.on('session_restart', (item) => {
    conversationLogger.logNewSessionStarting(item);
    terminalEmulator.clear();  // Clear old session content
    stateDetector.reset();  // Reset state detector for new session
    inputBuffer = '';  // Clear stale input from previous session
  });

  // Start Telegram polling for bidirectional communication
  if (telegramNotifier.isEnabled()) {
    telegramNotifier.startPolling();
    logger.info({ instanceId: telegramNotifier.getInstanceId() }, 'Telegram bidirectional communication enabled');
  }

  setupTelegramBridge({
    telegramNotifier,
    ptyWrapper,
    autoExecutor,
    stateDetector,
    display,
    queueManager,
    conversationLogger,
    terminalEmulator,
    setInputBuffer: (val: string) => { inputBuffer = val; },
  });

  // Connect terminal emulator to state detector for pattern analysis
  // Use last 25 lines to capture multi-line menus with descriptions (each option can be 2+ lines)
  stateDetector.setScreenContentProvider(() => terminalEmulator.getLastLines(25));

  // Helper to render queue prompt at bottom of terminal (needs to be accessible from PTY handler)
  const renderQueuePromptOverlay = (): void => {
    if (!inQueueInputMode) return;
    const rows = process.stdout.rows || 30;
    // Save cursor, move to last row, clear line, show prompt, restore cursor
    process.stdout.write(`\x1b7\x1b[${rows};1H\x1b[2K\x1b[33m[Q]\x1b[0m ${queueInputBuffer}\x1b8`);
  };

  // Debounced status bar re-render after PTY output
  // Higher debounce reduces flickering but may show stale content briefly
  const STATUS_BAR_DEBOUNCE_MS = 200;
  const reRenderStatusBar = debounce(() => {
    display.updateStatusBar(queueManager.getItems());
  }, STATUS_BAR_DEBOUNCE_MS);

  // Flag to set scroll region on first PTY output (ensures PTY is ready)
  let scrollRegionInitialized = false;

  ptyWrapper.on('data', (data: string) => {
    // Initialize scroll region on first PTY output
    if (!scrollRegionInitialized) {
      scrollRegionInitialized = true;
      const rows = process.stdout.rows || 30;
      process.stdout.write(`\x1b[${STATUS_BAR_HEIGHT + 1};${rows}r`);  // Scroll region: row 6 to bottom
      process.stdout.write(`\x1b[${STATUS_BAR_HEIGHT + 1};1H`);        // Move cursor to row 6, col 1
    }

    process.stdout.write(data);
    stateDetector.analyze(data);
    terminalEmulator.write(data);
    reRenderStatusBar();
    // Re-render queue prompt if in queue mode (PTY output may have overwritten it)
    renderQueuePromptOverlay();
  });

  setupPtyLifecycle({
    ptyWrapper,
    autoExecutor,
    conversationLogger,
    display,
    telegramNotifier,
    queueManager,
    batchReporter,
    cleanup,
    getClaudeArgs: () => claudeArgs,
  });

  const handleCommand = createCommandHandler({
    queueManager,
    display,
    autoExecutor,
    ptyWrapper,
    stateDetector,
    conversationLogger,
    terminalEmulator,
    getClaudeArgs: () => claudeArgs,
    setInHelpMode: (val: boolean) => { inHelpMode = val; },
  });


  process.stdin.on('data', async (data: Buffer) => {
    const input = data.toString();

    // Help mode — any keypress clears screen and returns to normal
    if (inHelpMode) {
      inHelpMode = false;
      // Clear screen and re-render
      const cols = process.stdout.columns || 80;
      const rows = process.stdout.rows || 30;
      process.stdout.write('\x1b[2J\x1b[H');  // Clear screen + cursor home
      display.updateStatusBar(queueManager.getItems());
      process.stdout.write(`\x1b[${STATUS_BAR_HEIGHT + 1};${rows}r`);  // Restore scroll region
      process.stdout.write(`\x1b[${STATUS_BAR_HEIGHT + 1};1H`);        // Cursor below status bar
      ptyWrapper.resize(cols, rows);  // Force Claude Code to redraw
      return;
    }

    // Multiline mode handling
    if (inMultilineMode) {
      if (input === '\r' || input === '\n') {
        // Use inputBuffer for reliable detection
        const currentLine = inputBuffer.trim();
        inputBuffer = '';

        if (currentLine === ':)') {
          // End multiline mode
          const prompt = multilineBuffer.join('\n');
          try {
            await queueManager.addItem(prompt, {
              isNewSession: multilineIsNewSession,
              isMultiline: true,
            });
            display.showMessage('success', `[Queue +1] Added multiline (${multilineBuffer.length} lines)`);
          } catch (err) {
            logger.error({ err }, 'Failed to add multiline item to queue');
            display.showMessage('error', '[Queue] Error: Failed to add multiline item');
          }

          // Reset state
          multilineBuffer = [];
          inMultilineMode = false;
          multilineIsNewSession = false;

          // Clear PTY line
          ptyWrapper.write('\x15');
          process.stdout.write('\r\x1b[2K');
          terminalEmulator.clear();
        } else {
          // Add line to buffer
          multilineBuffer.push(currentLine);
          // Show multiline prompt
          ptyWrapper.write('\x15');
          process.stdout.write(`\r\x1b[2K[ML ${multilineBuffer.length}] `);
          terminalEmulator.clear();
        }
      } else if (input === '\x7f' || input === '\b') {
        // Backspace - update buffer and pass to PTY
        inputBuffer = inputBuffer.slice(0, -1);
        ptyWrapper.write(input);
      } else if (input === '\x15') {
        // Ctrl+U - clear buffer and pass to PTY
        inputBuffer = '';
        ptyWrapper.write(input);
      } else if (input.startsWith('\x1b')) {
        // Escape sequences (arrows, etc) - don't add to buffer, pass to PTY
        ptyWrapper.write(input);
      } else {
        // Normal input - add to buffer and echo to PTY
        inputBuffer += input;
        ptyWrapper.write(input);
      }
      return;
    }

    // Helper to render queue prompt at bottom of terminal
    // Saves/restores cursor so PTY output continues at correct position
    const renderQueuePrompt = (buffer: string): void => {
      const rows = process.stdout.rows || 30;
      // Save cursor, move to last row, clear line, show prompt, restore cursor
      process.stdout.write(`\x1b7\x1b[${rows};1H\x1b[2K\x1b[33m[Q]\x1b[0m ${buffer}\x1b8`);
    };

    // Helper to clear queue prompt line at bottom
    const clearQueuePrompt = (): void => {
      const rows = process.stdout.rows || 30;
      process.stdout.write(`\x1b7\x1b[${rows};1H\x1b[2K\x1b8`);
    };

    // Queue input mode handling (triggered by : at empty prompt)
    if (inQueueInputMode) {
      if (input === '\r' || input === '\n') {
        // Enter - process command and exit mode
        const command = queueInputBuffer.trim();
        queueInputBuffer = '';
        inQueueInputMode = false;

        // Clear the queue prompt line
        clearQueuePrompt();

        if (command && isQueueCommand(command)) {
          await handleCommand(command);
        } else if (command) {
          // Not a valid queue command - show warning
          display.showMessage('warning', `[Queue] Unknown command: ${command}`);
        }
        // Don't send anything to PTY - stay at clean prompt
      } else if (input === '\x1b') {
        // Escape - cancel and exit mode
        queueInputBuffer = '';
        inQueueInputMode = false;
        clearQueuePrompt();
        display.showMessage('info', '[Queue] Cancelled');
      } else if (input === '\x7f' || input === '\b') {
        // Backspace
        if (queueInputBuffer.length > 0) {
          queueInputBuffer = queueInputBuffer.slice(0, -1);
          renderQueuePrompt(queueInputBuffer);
        }
      } else if (input === '\x15') {
        // Ctrl+U - clear buffer
        queueInputBuffer = '';
        renderQueuePrompt('');
      } else if (!input.startsWith('\x1b')) {
        // Normal input (ignore escape sequences like arrows)
        queueInputBuffer += input;
        renderQueuePrompt(queueInputBuffer);
      }
      return;
    }

    // Check for queue mode trigger (: at empty input)
    if (inputBuffer === '' && input === ':') {
      inQueueInputMode = true;
      queueInputBuffer = input;
      // Clear PTY line and show queue prompt at bottom
      ptyWrapper.write('\x15');
      renderQueuePrompt(queueInputBuffer);
      return;
    }

    // Check if Enter was pressed
    if (input === '\r' || input === '\n') {
      // Use inputBuffer for reliable command detection (avoids PTY echo timing issues)
      const currentLine = inputBuffer.trim();
      inputBuffer = '';

      logger.debug({ currentLine }, 'Enter pressed, checking line from inputBuffer');

      // Check for multiline start commands
      if (currentLine === ':(') {
        inMultilineMode = true;
        multilineIsNewSession = false;
        multilineBuffer = [];
        display.showMessage('info', '[Queue] Multiline mode (end with :))');
        ptyWrapper.write('\x15');
        process.stdout.write('\r\x1b[2K[ML 0] ');
        terminalEmulator.clear();
        return;
      }
      // Normal input - send Enter to PTY
      // (Queue commands are now handled in queue input mode)
      ptyWrapper.write('\r');
    } else if (input === '\x7f' || input === '\b') {
      // Backspace - update buffer and pass to PTY
      inputBuffer = inputBuffer.slice(0, -1);
      ptyWrapper.write(input);
    } else if (input === '\x03') {
      // Ctrl+C - clear buffer and pass to PTY
      inputBuffer = '';
      ptyWrapper.write(input);
    } else if (input === '\x15') {
      // Ctrl+U - clear buffer and pass to PTY
      inputBuffer = '';
      ptyWrapper.write(input);
    } else if (input.startsWith('\x1b')) {
      // Escape sequences (arrows, etc) - don't add to buffer, pass to PTY
      ptyWrapper.write(input);
    } else {
      // Normal input - add to buffer and pass to PTY
      inputBuffer += input;
      ptyWrapper.write(input);
    }
  });

  // Debounce resize handler to avoid excessive re-renders during rapid resizing
  const RESIZE_DEBOUNCE_MS = 100;
  const MIN_COLS = 40;
  const MIN_ROWS = 10;
  const handleResize = debounce(() => {
    const newCols = process.stdout.columns || 80;
    const newRows = process.stdout.rows || 30;
    // Re-render status bar first
    display.updateStatusBar(queueManager.getItems());
    // Re-set scroll region to exclude status bar after resize
    process.stdout.write(`\x1b[${STATUS_BAR_HEIGHT + 1};${newRows}r`);
    // Skip PTY resize if terminal is too small (prevents Claude Code crash)
    if (newCols < MIN_COLS || newRows < MIN_ROWS) {
      logger.debug({ newCols, newRows, MIN_COLS, MIN_ROWS }, 'Terminal too small, skipping PTY resize');
      return;
    }
    // Resize terminal emulator and PTY
    terminalEmulator.resize(newCols, newRows);
    ptyWrapper.resize(newCols, newRows);
  }, RESIZE_DEBOUNCE_MS);

  process.stdout.on('resize', handleResize);

  process.on('exit', () => {
    telegramNotifier.stopPolling();
    cleanup();
  });

  process.on('SIGINT', () => {
    ptyWrapper.write('\x03');
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM, shutting down...');
    cleanup();
    process.exit(0);
  });

  process.on('SIGHUP', () => {
    logger.info('Received SIGHUP, shutting down...');
    cleanup();
    process.exit(0);
  });

  // Exception handlers
  process.on('uncaughtException', (error) => {
    logger.error({ error }, 'Uncaught exception');
    cleanup();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection');
    cleanup();
    process.exit(1);
  });

  try {
    ptyWrapper.spawn(claudeArgs);
    // Scroll region is set on first PTY data event (see ptyWrapper.on('data') handler)
  } catch (error) {
    logger.error({ error }, 'Failed to spawn Claude Code');
    cleanup();
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error({ error }, 'Unhandled error in main');
  process.exit(1);
});
