import path from 'path';
import { existsSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir, hostname as osHostname } from 'os';
import { logger } from './utils/logger.js';
import { t } from './utils/telegram-messages.js';
import {
  getSessionFilePath,
  extractConversations,
  formatConversationsForLog,
} from './utils/session-log-extractor.js';
import type { TelegramNotifier } from './utils/telegram.js';
import type { PtyWrapper } from './pty-wrapper.js';
import type { AutoExecutor } from './auto-executor.js';
import type { StateDetector } from './state-detector.js';
import type { IDisplay } from './interfaces/display.js';
import type { QueueManager } from './queue-manager.js';
import type { ConversationLogger } from './utils/conversation-logger.js';
import type { TerminalEmulator } from './utils/terminal-emulator.js';

export interface TelegramBridgeContext {
  telegramNotifier: TelegramNotifier;
  ptyWrapper: PtyWrapper;
  autoExecutor: AutoExecutor;
  stateDetector: StateDetector;
  display: IDisplay;
  queueManager: QueueManager;
  conversationLogger: ConversationLogger;
  terminalEmulator: TerminalEmulator;
  setInputBuffer: (val: string) => void;
  cwd?: string;
}

export function setupTelegramBridge(ctx: TelegramBridgeContext): void {
  const {
    telegramNotifier, ptyWrapper, autoExecutor, stateDetector,
    display, queueManager, conversationLogger, terminalEmulator, setInputBuffer,
    cwd = process.cwd(),
  } = ctx;

  // Handle commands from Telegram inline keyboard
  telegramNotifier.on('command', (cmd) => {
    logger.info({ cmd }, 'Received Telegram command');

    // Handle numbered selections (select1-16)
    const selectMatch = cmd.match(/^select(\d+)$/);
    if (selectMatch) {
      const num = selectMatch[1];
      setInputBuffer('');  // Clear stale user input
      ptyWrapper.write(num);
      display.showMessage('info', `[Telegram] Option ${num} selected`);
      return;
    }

    switch (cmd) {
      case 'escape':
        // Send Escape to cancel selection
        setInputBuffer('');  // Clear stale user input
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

    const ptyStatus = isRunning ? t('status.pty_running') : t('status.pty_stopped');
    const autoStatus = isPaused ? t('status.autoexec_paused') : t('status.autoexec_active');

    const lines = [
      t('status.header'),
      ``,
      `🖥️ ${telegramNotifier.getInstanceId()}`,
      `📁 ${path.basename(cwd)}`,
      ``,
      t('status.pty', { status: ptyStatus }),
      t('status.state', { state: state.type }),
      t('status.autoexec', { status: autoStatus }),
      `${t('queue.label')}: ${t('queue.items', { count: queueLength })}`,
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
        t('log.queue_caption', { instanceId: telegramNotifier.getInstanceId() })
      );
      if (sent) sentCount++;
    }

    // 2. Send current session log (converted from JSONL)
    if (sessionId) {
      const sessionPath = getSessionFilePath(cwd, sessionId);
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
              t('log.session_caption')
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
      telegramNotifier.replyToChat(chatId, messageId, t('log.none'));
    } else {
      telegramNotifier.replyToChat(chatId, messageId, t('log.sent', { count: sentCount }));
    }
  });

  // Handle display request from Telegram - send current screen buffer
  telegramNotifier.on('display_request', (chatId, messageId) => {
    logger.debug({ chatId, messageId }, 'Handling display_request event');
    const lines = terminalEmulator.getLastLines(25); // Same as screenContent in debug log
    const currentState = stateDetector.getState();
    const hostname = osHostname();

    if (lines.length === 0) {
      logger.debug('display_request: empty lines');
      telegramNotifier.replyToChat(chatId, messageId, t('display.empty'));
      return;
    }

    // Clean ANSI codes and join lines
    const content = lines
      .map(line => line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''))
      .join('\n')
      .trim();

    if (!content) {
      logger.debug('display_request: empty content after ANSI cleanup');
      telegramNotifier.replyToChat(chatId, messageId, t('display.empty'));
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
    setInputBuffer('');  // Clear stale user input
    // First send the option number to select it
    ptyWrapper.write(String(optionNumber));
    // Wait for text input mode, then send text as separate block, then Enter as separate block
    setTimeout(() => {
      ptyWrapper.write(text);
      // Send Enter as a separate input block to submit
      setTimeout(() => {
        ptyWrapper.write('\r');
        display.showMessage('info', `[Telegram] #${optionNumber} + "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}" sent`);
      }, 100);
    }, 150);
  });

  // Handle direct text send from Telegram (/send command or notification reply)
  telegramNotifier.on('send_text', (text) => {
    logger.info({ text }, 'Telegram send_text received');
    setInputBuffer('');  // Clear stale user input
    // Send text first, then Enter as separate block (for multiline input mode)
    ptyWrapper.write(text);
    setTimeout(() => {
      ptyWrapper.write('\r');
      display.showMessage('info', `[Telegram] "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}" sent`);
    }, 100);
  });

  // Handle key input from Telegram (/key command - without Enter)
  telegramNotifier.on('key_input', (text) => {
    logger.info({ text }, 'Telegram key_input received');
    setInputBuffer('');  // Clear stale user input
    // Send text only, no Enter
    ptyWrapper.write(text);
    display.showMessage('info', `[Telegram] ⌨️ "${text.slice(0, 20)}${text.length > 20 ? '...' : ''}" typed`);
  });
}
