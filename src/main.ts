#!/usr/bin/env node

import path, { isAbsolute } from 'path';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir, hostname as osHostname } from 'os';
import { execSync } from 'child_process';
import { PtyWrapper } from './pty-wrapper.js';
import { logger, reconfigureLogger } from './utils/logger.js';
import { parseArgs } from './utils/cli-args.js';
import { createCleanup } from './utils/cleanup.js';
import { debounce } from './utils/debounce.js';
import { TerminalEmulator } from './utils/terminal-emulator.js';
import { parse, isQueueCommand } from './input-parser.js';
import { QueueManager } from './queue-manager.js';
import { Display } from './display.js';
import { StateDetector } from './state-detector.js';
import { AutoExecutor } from './auto-executor.js';
import { loadConfig, ensureConfigDir, isFirstRun, QLAUDE_DIR } from './utils/config.js';
import { ConversationLogger } from './utils/conversation-logger.js';
import { TelegramNotifier } from './utils/telegram.js';
import { t, setMessageOverrides } from './utils/telegram-messages.js';
import { BatchReporter } from './utils/batch-report.js';
import { getSessionFilePath, extractConversations, formatConversationsForLog } from './utils/session-log-extractor.js';
import { saveSessionLabel, getSessionLabel } from './utils/session-labels.js';
import type { ReloadResult } from './types/queue.js';
import { ErrorCode, getUserFriendlyMessage } from './types/errors.js';
import { compilePatterns } from './utils/pattern-compiler.js';

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
if (config.telegram.messages) {
  setMessageOverrides(config.telegram.messages);
}
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

const TRUNCATE_LENGTH = 30;

/**
 * Truncate prompt for display (max 30 chars)
 */
function truncatePrompt(prompt: string): string {
  return prompt.length > TRUNCATE_LENGTH
    ? prompt.slice(0, TRUNCATE_LENGTH) + '...'
    : prompt;
}

function setupTerminal(): void {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
}

/**
 * Get Claude Code version by running `claude --version`
 * Returns version string like "2.1.31" or null if failed
 */
function getClaudeCodeVersion(): string | null {
  try {
    const output = execSync('claude --version', { encoding: 'utf-8', timeout: 5000 });
    // Output format: "Claude Code v2.1.31" or similar
    const match = output.match(/v?(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    logger.warn('Failed to get Claude Code version');
    return null;
  }
}

/**
 * Compare version strings (e.g., "2.1.30" >= "2.1.30")
 */
function isVersionAtLeast(version: string, minVersion: string): boolean {
  const v1 = version.split('.').map(Number);
  const v2 = minVersion.split('.').map(Number);
  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const a = v1[i] || 0;
    const b = v2[i] || 0;
    if (a > b) return true;
    if (a < b) return false;
  }
  return true; // Equal
}

/**
 * Check if Windows workaround for Claude Code >= 2.1.30 is needed
 */
function needsWindowsWorkaround(): boolean {
  if (process.platform !== 'win32') return false;
  const version = getClaudeCodeVersion();
  if (!version) return false;
  const needed = isVersionAtLeast(version, '2.1.30');
  logger.info({ platform: process.platform, version, needed }, 'Windows workaround check');
  return needed;
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

  // Windows workaround: flag to track if initial Enter has been sent
  let windowsWorkaroundApplied = false;
  const applyWindowsWorkaround = needsWindowsWorkaround();

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
    windowsWorkaroundApplied = false;  // Re-apply Enter+resize for new PTY
  });

  // Start Telegram polling for bidirectional communication
  if (telegramNotifier.isEnabled()) {
    telegramNotifier.startPolling();
    logger.info({ instanceId: telegramNotifier.getInstanceId() }, 'Telegram bidirectional communication enabled');
  }

  // Handle commands from Telegram inline keyboard
  telegramNotifier.on('command', (cmd) => {
    logger.info({ cmd }, 'Received Telegram command');

    // Handle numbered selections (select1-16)
    const selectMatch = cmd.match(/^select(\d+)$/);
    if (selectMatch) {
      const num = selectMatch[1];
      inputBuffer = '';  // Clear stale user input
      ptyWrapper.write(num);
      display.showMessage('info', `[Telegram] Option ${num} selected`);
      return;
    }

    switch (cmd) {
      case 'escape':
        // Send Escape to cancel selection
        inputBuffer = '';  // Clear stale user input
        ptyWrapper.write('\x1b');
        display.showMessage('info', '[Telegram] Selection cancelled');
        break;

      case 'pause':
        // Pause auto-execution
        autoExecutor.stop();
        display.setPaused(true);
        display.showMessage('warning', '[Telegram] Auto-execution paused');
        break;

      case 'resume':
        // Resume auto-execution
        autoExecutor.start();
        display.setPaused(false);
        display.showMessage('success', '[Telegram] Auto-execution resumed');
        stateDetector.forceReady();
        break;
    }
  });

  // Handle status request from Telegram
  telegramNotifier.on('status_request', (chatId, messageId) => {
    logger.debug({ chatId, messageId }, 'Handling status_request event');
    const queueLength = queueManager.getLength();
    const state = stateDetector.getState();
    const isPaused = !autoExecutor.isEnabled();
    const isRunning = ptyWrapper.isRunning();

    const lang = telegramNotifier.getLanguage();
    const ptyStatus = isRunning ? t('status.pty_running', lang) : t('status.pty_stopped', lang);
    const autoStatus = isPaused ? t('status.autoexec_paused', lang) : t('status.autoexec_active', lang);

    const lines = [
      t('status.header', lang),
      ``,
      `🖥️ ${telegramNotifier.getInstanceId()}`,
      `📁 ${path.basename(process.cwd())}`,
      ``,
      t('status.pty', lang, { status: ptyStatus }),
      t('status.state', lang, { state: state.type }),
      t('status.autoexec', lang, { status: autoStatus }),
      `${t('queue.label', lang)}: ${t('queue.items', lang, { count: queueLength })}`,
    ];

    telegramNotifier.replyToChat(chatId, messageId, lines.join('\n'));
  });

  // Handle log request from Telegram - send queue log and current session log
  telegramNotifier.on('log_request', async (chatId, messageId) => {
    const queueLogPath = conversationLogger.getLatestQueueLogPath();
    // Refresh session ID from hook file before getting it
    conversationLogger.refreshSessionId();
    const sessionId = conversationLogger.getCurrentSessionId();
    let sentCount = 0;

    // 1. Send queue log if available
    if (queueLogPath && existsSync(queueLogPath)) {
      const sent = await telegramNotifier.sendDocument(
        chatId,
        messageId,
        queueLogPath,
        t('log.queue_caption', telegramNotifier.getLanguage(), { instanceId: telegramNotifier.getInstanceId() })
      );
      if (sent) sentCount++;
    }

    // 2. Send current session log (converted from JSONL)
    if (sessionId) {
      const sessionPath = getSessionFilePath(process.cwd(), sessionId);
      logger.debug({ sessionId, sessionPath }, 'Session log path lookup');

      if (sessionPath && existsSync(sessionPath)) {
        try {
          const conversations = extractConversations(sessionPath);
          const formatted = formatConversationsForLog(conversations, true);
          logger.debug({ conversationCount: conversations.length, hasFormatted: !!formatted }, 'Session log extracted');

          if (formatted) {
            // Save to temp file
            const tempPath = path.join(tmpdir(), `session-${sessionId.slice(0, 8)}.log`);
            writeFileSync(tempPath, formatted, 'utf-8');

            const sent = await telegramNotifier.sendDocument(
              chatId,
              messageId,
              tempPath,
              t('log.session_caption', telegramNotifier.getLanguage())
            );
            if (sent) sentCount++;

            // Cleanup temp file
            try { unlinkSync(tempPath); } catch { /* ignore */ }
          } else {
            logger.debug({ sessionId }, 'Session log formatted content is empty');
          }
        } catch (err) {
          logger.error({ err, sessionId }, 'Failed to extract session log');
        }
      } else {
        logger.debug({ sessionId, sessionPath, exists: sessionPath ? existsSync(sessionPath) : false }, 'Session file not found');
      }
    } else {
      logger.debug('No session ID available for log extraction');
    }

    // Result message
    if (sentCount === 0) {
      telegramNotifier.replyToChat(chatId, messageId, t('log.none', telegramNotifier.getLanguage()));
    } else {
      telegramNotifier.replyToChat(chatId, messageId, t('log.sent', telegramNotifier.getLanguage(), { count: sentCount }));
    }
  });

  // Handle display request from Telegram - send current screen buffer (same as debug log screenContent)
  telegramNotifier.on('display_request', (chatId, messageId) => {
    logger.debug({ chatId, messageId }, 'Handling display_request event');
    const lines = terminalEmulator.getLastLines(25); // Same as screenContent in debug log
    const currentState = stateDetector.getState();
    const hostname = osHostname();

    if (lines.length === 0) {
      logger.debug('display_request: empty lines');
      telegramNotifier.replyToChat(chatId, messageId, t('display.empty', telegramNotifier.getLanguage()));
      return;
    }

    // Clean ANSI codes and join lines
    const content = lines
      .map(line => line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''))
      .join('\n')
      .trim();

    if (!content) {
      logger.debug('display_request: empty content after ANSI cleanup');
      telegramNotifier.replyToChat(chatId, messageId, t('display.empty', telegramNotifier.getLanguage()));
      return;
    }

    // Build header with source info
    const header = `🖥️ ${hostname} | State: ${currentState.type} | Lines: ${lines.length}`;

    // Send as plain text code block (limit to 3900 chars for Telegram 4096 limit)
    const truncated = content.length > 3900 ? content.slice(-3900) + '\n...(truncated)' : content;
    const message = `${header}\n\`\`\`\n${truncated}\n\`\`\``;
    logger.debug({ textLength: message.length }, 'display_request: sending reply');
    telegramNotifier.replyToChat(chatId, messageId, message);
  });

  // Handle text input from Telegram (option number + text)
  telegramNotifier.on('text_input', (optionNumber, text) => {
    logger.info({ optionNumber, text }, 'Telegram text_input received');
    inputBuffer = '';  // Clear stale user input
    // First send the option number to select it
    ptyWrapper.write(String(optionNumber));
    // Wait for text input mode, then send text as separate block, then Enter as separate block
    setTimeout(() => {
      ptyWrapper.write(text);
      // Send Enter as a separate input block to submit
      setTimeout(() => {
        ptyWrapper.write('\r');
        display.showMessage('info', `[Telegram] ${optionNumber}번 + "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}" 전송됨`);
      }, 100);
    }, 150);
  });

  // Handle direct text send from Telegram (/send command or notification reply)
  telegramNotifier.on('send_text', (text) => {
    logger.info({ text }, 'Telegram send_text received');
    inputBuffer = '';  // Clear stale user input
    // Send text first, then Enter as separate block (for multiline input mode)
    ptyWrapper.write(text);
    setTimeout(() => {
      ptyWrapper.write('\r');
      display.showMessage('info', `[Telegram] "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}" 전송됨`);
    }, 100);
  });

  // Handle key input from Telegram (/key command - without Enter)
  telegramNotifier.on('key_input', (text) => {
    logger.info({ text }, 'Telegram key_input received');
    inputBuffer = '';  // Clear stale user input
    // Send text only, no Enter
    ptyWrapper.write(text);
    display.showMessage('info', `[Telegram] ⌨️ "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}" 입력됨`);
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

    // Windows workaround: send Enter when Claude Code input prompt is detected
    // Detect ─ line followed immediately by ❯ (within 5 chars - newline + spaces)
    // This pattern matches the input prompt but not security/selection prompts
    if (applyWindowsWorkaround && !windowsWorkaroundApplied && /─{5,}[\s\S]{0,5}❯/.test(data)) {
      windowsWorkaroundApplied = true;
      logger.info('Windows workaround: input prompt detected, sending Enter + resize');
      display.showMessage('info', '[Windows] Prompt detected, sending Enter...');
      // Small delay to let the prompt render first
      setTimeout(() => {
        ptyWrapper.write('\r');
        const cols = process.stdout.columns || 80;
        const rows = process.stdout.rows || 30;
        ptyWrapper.resize(cols, rows);
      }, 50);
    }

    process.stdout.write(data);
    stateDetector.analyze(data);
    terminalEmulator.write(data);
    reRenderStatusBar();
    // Re-render queue prompt if in queue mode (PTY output may have overwritten it)
    renderQueuePromptOverlay();
  });

  ptyWrapper.on('exit', async (exitCode: number) => {
    // Check if this exit happened during a session load (--resume with invalid session ID)
    // In that case, recover by restarting PTY fresh instead of terminating qlaude
    if (exitCode !== 0 && autoExecutor.hasPendingSessionLoad()) {
      logger.warn({ exitCode }, 'PTY exited during session load, recovering...');
      await autoExecutor.handlePtyExitDuringSessionLoad();

      // Restart PTY fresh (without --resume) so qlaude stays operational
      try {
        ptyWrapper.spawn(claudeArgs);
        logger.info('PTY restarted after session load failure');
      } catch (error) {
        logger.error({ error }, 'Failed to restart PTY after session load failure');
        cleanup();
        process.exit(1);
      }
      return;
    }

    // Queue active + non-zero exit → crash recovery with session resume
    if (exitCode !== 0 && autoExecutor.isQueueActive()) {
      const sessionId = conversationLogger.getCurrentSessionId();
      logger.warn({ exitCode, sessionId }, 'PTY crashed during queue execution, attempting recovery');
      display.showMessage('warning', '[Queue] Claude Code crashed. Recovering...');

      const shouldRestart = await autoExecutor.handlePtyCrashRecovery();

      if (!shouldRestart) {
        // Max crash recoveries exceeded - restart PTY without queue execution
        try {
          ptyWrapper.spawn(claudeArgs);
          logger.info('PTY restarted in idle mode after max crash recoveries');
        } catch (error) {
          logger.error({ error }, 'Failed to restart PTY after max crash recoveries');
          cleanup();
          process.exit(1);
        }
        return;
      }

      telegramNotifier.notify('pty_crashed', {
        queueLength: queueManager.getLength(),
        message: sessionId ? 'Resuming session...' : 'Restarting fresh...',
      });

      try {
        if (sessionId) {
          ptyWrapper.spawn(['--resume', sessionId, ...claudeArgs]);
          logger.info({ sessionId }, 'PTY restarted with --resume after crash');
        } else {
          ptyWrapper.spawn(claudeArgs);
          logger.info('PTY restarted fresh after crash (no session ID)');
        }
      } catch (error) {
        logger.error({ error }, 'Failed to restart PTY after crash');
        cleanup();
        process.exit(1);
      }
      return;
    }

    if (batchReporter && exitCode !== 0) {
      batchReporter.writeReport('failed', `PTY exited with code ${exitCode}`);
      cleanup();
      process.exit(1);
    }
    if (exitCode !== 0) {
      display.showMessage('error', getUserFriendlyMessage(ErrorCode.PTY_UNEXPECTED_EXIT));
    }
    cleanup();
    process.exit(exitCode);
  });

  /**
   * Handle a complete command (after buffering)
   */
  async function handleCommand(input: string): Promise<void> {
    const result = parse(input);

    switch (result.type) {
      case 'QUEUE_ADD':
        if (result.prompt) {
          try {
            // Check for @ directive in prompt
            if (result.prompt.startsWith('\\@')) {
              // Escaped @ — literal @ prompt
              const unescaped = result.prompt.slice(1);
              await queueManager.addItem(unescaped);
              display.showMessage('success', `[Queue +1] Added: "${truncatePrompt(unescaped)}"`);
            } else if (result.prompt.startsWith('@')) {
              // Parse @ directive
              const rest = result.prompt.slice(1);
              const spaceIdx = rest.indexOf(' ');
              const directive = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).toLowerCase();
              const dArgs = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();

              switch (directive) {
                case 'new':
                  await queueManager.addItem('', { isNewSession: true });
                  display.showMessage('success', '[Queue +1] New session marker added');
                  break;
                case 'pause':
                  await queueManager.addItem(dArgs, { isBreakpoint: true });
                  display.showMessage('success', `[Queue +1] Pause: "${dArgs || '(no reason)'}"`);
                  break;
                case 'save':
                  if (!dArgs) {
                    display.showMessage('error', '[Queue] Usage: :add @save name');
                    break;
                  }
                  await queueManager.addItem('', { labelSession: dArgs });
                  display.showMessage('success', `[Queue +1] Save: "${dArgs}"`);
                  break;
                case 'load':
                  if (!dArgs) {
                    display.showMessage('error', '[Queue] Usage: :add @load name');
                    break;
                  }
                  await queueManager.addItem('', { loadSessionLabel: dArgs });
                  display.showMessage('success', `[Queue +1] Load: "${dArgs}"`);
                  break;
                case 'model':
                  if (!dArgs) {
                    display.showMessage('error', '[Queue] Usage: :add @model name');
                    break;
                  }
                  await queueManager.addItem(`/model ${dArgs}`, { modelName: dArgs });
                  display.showMessage('success', `[Queue +1] Model: ${dArgs}`);
                  break;
                case 'delay': {
                  const ms = parseInt(dArgs, 10);
                  if (!ms || ms <= 0) {
                    display.showMessage('error', '[Queue] Usage: :add @delay <ms>');
                    break;
                  }
                  await queueManager.addItem('', { delayMs: ms });
                  display.showMessage('success', `[Queue +1] Delay: ${ms}ms`);
                  break;
                }
                default:
                  // Unknown @ directive — add as regular prompt
                  await queueManager.addItem(result.prompt);
                  display.showMessage('success', `[Queue +1] Added: "${truncatePrompt(result.prompt)}"`);
              }
            } else {
              // Regular prompt
              await queueManager.addItem(result.prompt);
              display.showMessage('success', `[Queue +1] Added: "${truncatePrompt(result.prompt)}"`);
            }
          } catch (err) {
            logger.error({ err }, 'Failed to add item to queue');
            display.showMessage('error', '[Queue] Error: Failed to add item');
          }
        } else {
          display.showMessage('error', '[Queue] Error: Empty prompt');
        }
        break;
      case 'QUEUE_REMOVE':
        try {
          const removed = await queueManager.removeLastItem();
          if (removed) {
            const truncated = truncatePrompt(removed.prompt);
            display.showMessage('info', `[Queue -1] Removed: "${truncated}"`);
          } else {
            display.showMessage('warning', '[Queue] Queue is empty');
          }
        } catch (err) {
          logger.error({ err }, 'Failed to remove item from queue');
          display.showMessage('error', '[Queue] Error: Failed to remove item');
        }
        break;
      case 'QUEUE_SAVE_SESSION':
        // Immediate execution: save current session ID with label
        if (result.label) {
          conversationLogger.refreshSessionId();
          const sessionId = conversationLogger.getCurrentSessionId();
          if (sessionId) {
            try {
              const wasOverwritten = saveSessionLabel(result.label, sessionId);
              if (wasOverwritten) {
                display.showMessage('warning', `[Session] Label "${result.label}" overwritten`);
              }
              display.showMessage('success', `[Session] Saved: "${result.label}"`);
              logger.info({ label: result.label, sessionId, wasOverwritten }, 'Session saved immediately');
            } catch (err) {
              logger.error({ err }, 'Failed to save session label');
              display.showMessage('error', '[Session] Error: Failed to save');
            }
          } else {
            display.showMessage('error', '[Session] Error: No active session');
          }
        } else {
          display.showMessage('error', '[Session] Error: No label specified');
        }
        break;
      case 'QUEUE_LOAD_SESSION':
        // Immediate execution: load saved session by restarting PTY with --resume
        if (result.label) {
          const sessionId = getSessionLabel(result.label);
          if (sessionId) {
            display.showMessage('info', `[Session] Loading: "${result.label}"...`);
            logger.info({ label: result.label, sessionId }, 'Loading session immediately');
            try {
              const args = ['--resume', sessionId, ...claudeArgs];
              await ptyWrapper.restart(args);
              terminalEmulator.clear();
              stateDetector.reset();
              display.showMessage('success', `[Session] Loaded: "${result.label}"`);
            } catch (err) {
              logger.error({ err }, 'Failed to load session');
              display.showMessage('error', '[Session] Error: Failed to load session');
            }
          } else {
            display.showMessage('error', `[Session] Error: Label "${result.label}" not found`);
          }
        } else {
          display.showMessage('error', '[Session] Error: No label specified');
        }
        break;
      case 'META_RELOAD':
        try {
          const reloadResult: ReloadResult = await queueManager.reload();
          if (!reloadResult.fileFound) {
            display.showMessage('warning', '[Queue] Queue file not found');
          } else {
            display.showMessage('info', `[Queue] Reloaded: ${reloadResult.itemCount} items`);
            if (reloadResult.skippedLines > 0) {
              display.showMessage('warning', `[Queue] Warning: ${reloadResult.skippedLines} invalid lines skipped`);
            }
          }
        } catch (err) {
          logger.error({ err }, 'Failed to reload queue');
          display.showMessage('error', '[Queue] Error: Failed to reload queue');
        }
        break;
      case 'META_STATUS':
        {
          const isEnabled = display.toggle();
          const status = isEnabled ? 'ON' : 'OFF';
          if (isEnabled) {
            display.updateStatusBar(queueManager.getItems());
          } else {
            // Trigger PTY resize to make Claude Code redraw the screen
            const cols = process.stdout.columns || 80;
            const rows = process.stdout.rows || 30;
            ptyWrapper.resize(cols, rows);
          }
          display.showMessage('info', `[Queue] Status bar: ${status}`);
        }
        break;
      case 'META_PAUSE':
        {
          autoExecutor.stop();
          display.setPaused(true);
          display.showMessage('warning', '[Queue] Auto-execution paused');
        }
        break;
      case 'META_RESUME':
        {
          autoExecutor.start();
          display.setPaused(false);
          display.showMessage('success', '[Queue] Auto-execution resumed');
          // Immediately transition to READY to execute next item (no timer delay)
          stateDetector.forceReady();
        }
        break;
      case 'META_MODEL':
        if (result.label) {
          display.showMessage('info', `[Session] Switching model: ${result.label}`);
          ptyWrapper.write(`/model ${result.label}`);
          await new Promise((resolve) => setTimeout(resolve, 50));
          ptyWrapper.write('\r');
        } else {
          display.showMessage('error', '[Queue] Usage: :model name');
        }
        break;
      case 'META_HELP':
        {
          const helpLines = [
            'Commands (: prefix, all immediate):',
            '  :add text         Add prompt to queue',
            '  :add @directive   Add @new, @pause, @save, @load, @model, @delay',
            '  :drop             Remove last item',
            '  :clear            Clear entire queue',
            '  :save name        Save current session',
            '  :load name        Load saved session',
            '  :model name       Switch model (sends /model)',
            '  :pause            Pause auto-execution',
            '  :resume           Resume auto-execution',
            '  :reload           Reload queue file',
            '  :status           Toggle status bar',
            '  :list             Show queue contents',
            '  :help             Show this help',
            'Multiline:',
            '  :(  ... :)        Multiline prompt',
            'Queue file (@ prefix):',
            '  @new, @save, @load, @pause, @model, @delay',
            '  @( ... @)         Multiline prompt',
          ];
          // Show help in PTY area — press any key to dismiss
          process.stdout.write('\n' + helpLines.join('\n') + '\n\n(Press any key to return)\n');
          inHelpMode = true;
        }
        break;
      case 'META_LIST':
        {
          const items = queueManager.getItems();
          if (items.length === 0) {
            display.showMessage('info', '[Queue] Empty');
          } else {
            const listLines = items.map((item, i) => {
              let tag = '';
              if (item.delayMs) tag = `[DELAY:${item.delayMs}ms] `;
              else if (item.modelName) tag = `[MODEL:${item.modelName}] `;
              else if (item.isBreakpoint) tag = '[PAUSE] ';
              else if (item.labelSession) tag = `[SAVE:${item.labelSession}] `;
              else if (item.loadSessionLabel) tag = `[LOAD:${item.loadSessionLabel}] `;
              else if (item.isNewSession) tag = '[New Session] ';
              if (item.isMultiline) tag = `[ML] ${tag}`;
              const prompt = item.prompt
                ? (item.prompt.length > 60 ? item.prompt.slice(0, 60) + '...' : item.prompt)
                : '';
              return `  ${i + 1}. ${tag}${prompt}`;
            });
            process.stdout.write(`\n[Queue: ${items.length} items]\n${listLines.join('\n')}\n`);
            display.showMessage('info', `[Queue] ${items.length} items`);
          }
        }
        break;
      case 'QUEUE_CLEAR':
        {
          const items = queueManager.getItems();
          if (items.length === 0) {
            display.showMessage('info', '[Queue] Already empty');
          } else {
            const count = items.length;
            // Remove all items by popping each
            for (let i = 0; i < count; i++) {
              await queueManager.removeLastItem();
            }
            display.showMessage('success', `[Queue] Cleared ${count} items`);
          }
        }
        break;
      case 'PASSTHROUGH':
      default:
        // Send buffered content + Enter to PTY
        ptyWrapper.write(input + '\r');
        break;
    }
  }

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

  // Unix-only signals (not supported on Windows)
  if (process.platform !== 'win32') {
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
  }

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
    // Windows workaround is applied on first READY state (see stateDetector state_change handler)
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
