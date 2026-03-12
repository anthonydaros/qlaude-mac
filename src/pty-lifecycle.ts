import { logger } from './utils/logger.js';
import { ErrorCode, getUserFriendlyMessage } from './types/errors.js';
import type { PtyWrapper } from './pty-wrapper.js';
import type { AutoExecutor } from './auto-executor.js';
import type { ConversationLogger } from './utils/conversation-logger.js';
import type { Display } from './display.js';
import type { TelegramNotifier } from './utils/telegram.js';
import type { QueueManager } from './queue-manager.js';
import type { BatchReporter } from './utils/batch-report.js';

export interface PtyLifecycleContext {
  ptyWrapper: PtyWrapper;
  autoExecutor: AutoExecutor;
  conversationLogger: ConversationLogger;
  display: Display;
  telegramNotifier: TelegramNotifier;
  queueManager: QueueManager;
  batchReporter: BatchReporter | null;
  cleanup: () => void;
  getClaudeArgs: () => string[];
}

export function setupPtyLifecycle(ctx: PtyLifecycleContext): void {
  const {
    ptyWrapper, autoExecutor, conversationLogger, display,
    telegramNotifier, queueManager, batchReporter, cleanup, getClaudeArgs,
  } = ctx;

  ptyWrapper.on('exit', async (exitCode: number) => {
    // Check if this exit happened during a session load (--resume with invalid session ID)
    // In that case, recover by restarting PTY fresh instead of terminating qlaude
    if (exitCode !== 0 && autoExecutor.hasPendingSessionLoad()) {
      logger.warn({ exitCode }, 'PTY exited during session load, recovering...');
      await autoExecutor.handlePtyExitDuringSessionLoad();

      // Restart PTY fresh (without --resume) so qlaude stays operational
      try {
        ptyWrapper.spawn(getClaudeArgs());
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
          ptyWrapper.spawn(getClaudeArgs());
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
          ptyWrapper.spawn(['--resume', sessionId, ...getClaudeArgs()]);
          logger.info({ sessionId }, 'PTY restarted with --resume after crash');
        } else {
          ptyWrapper.spawn(getClaudeArgs());
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
}
