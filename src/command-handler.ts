import { parse } from './input-parser.js';
import { logger } from './utils/logger.js';
import { saveSessionLabel, getSessionLabel } from './utils/session-labels.js';
import type { QueueManager } from './queue-manager.js';
import type { IDisplay } from './interfaces/display.js';
import type { AutoExecutor } from './auto-executor.js';
import type { PtyWrapper } from './pty-wrapper.js';
import type { StateDetector } from './state-detector.js';
import type { ConversationLogger } from './utils/conversation-logger.js';
import type { TerminalEmulator } from './utils/terminal-emulator.js';
import type { ReloadResult } from './types/queue.js';

const TRUNCATE_LENGTH = 30;

function truncatePrompt(prompt: string): string {
  return prompt.length > TRUNCATE_LENGTH
    ? prompt.slice(0, TRUNCATE_LENGTH) + '...'
    : prompt;
}

export interface CommandHandlerContext {
  queueManager: QueueManager;
  display: IDisplay;
  autoExecutor: AutoExecutor;
  ptyWrapper: PtyWrapper;
  stateDetector: StateDetector;
  conversationLogger: ConversationLogger;
  terminalEmulator: TerminalEmulator;
  getClaudeArgs: () => string[];
  setInHelpMode: (val: boolean) => void;
  writeOutput?: (text: string) => void;
}

export function createCommandHandler(ctx: CommandHandlerContext): (input: string) => Promise<void> {
  const {
    queueManager, display, autoExecutor, ptyWrapper, stateDetector,
    conversationLogger, terminalEmulator, getClaudeArgs, setInHelpMode,
    writeOutput = (text: string) => process.stdout.write(text),
  } = ctx;

  return async function handleCommand(input: string): Promise<void> {
    const result = parse(input);

    switch (result.type) {
      case 'QUEUE_ADD':
        if (result.prompt) {
          try {
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
              const args = ['--resume', sessionId, ...getClaudeArgs()];
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
          writeOutput('\n' + helpLines.join('\n') + '\n\n(Press any key to return)\n');
          setInHelpMode(true);
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
            writeOutput(`\n[Queue: ${items.length} items]\n${listLines.join('\n')}\n`);
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
  };
}
