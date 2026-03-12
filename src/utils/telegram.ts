/**
 * Telegram notification utility with bidirectional communication
 * Sends notifications via Telegram Bot API and receives commands via inline keyboard callbacks
 */

import { EventEmitter } from 'events';
import { logger } from './logger.js';
import { t } from './telegram-messages.js';
import type { TelegramConfig } from '../types/config.js';
import type { ParsedOption } from '../types/state.js';
import path from 'path';
import os from 'os';

/**
 * Notification types for different events
 */
export type NotificationType =
  | 'selection_prompt'
  | 'interrupted'
  | 'breakpoint'
  | 'queue_started'
  | 'queue_completed'
  | 'task_failed'
  | 'pty_crashed';

/**
 * Command types from Telegram callbacks
 */
export type TelegramCommand =
  | 'select1'    // Send '1' to PTY
  | 'select2'    // Send '2' to PTY
  | 'select3'    // Send '3' to PTY
  | 'select4'    // Send '4' to PTY
  | 'select5'    // Send '5' to PTY
  | 'select6'    // Send '6' to PTY
  | 'select7'    // Send '7' to PTY
  | 'select8'    // Send '8' to PTY
  | 'select9'    // Send '9' to PTY
  | 'select10'   // Send '10' to PTY
  | 'select11'   // Send '11' to PTY
  | 'select12'   // Send '12' to PTY
  | 'select13'   // Send '13' to PTY
  | 'select14'   // Send '14' to PTY
  | 'select15'   // Send '15' to PTY
  | 'select16'   // Send '16' to PTY
  | 'escape'     // Send Escape to PTY (cancel selection)
  | 'pause'      // Pause queue execution
  | 'resume';    // Resume queue execution

/**
 * Inline keyboard button definition
 */
interface InlineButton {
  text: string;
  callback_data: string;
}

/**
 * Telegram callback query from getUpdates
 */
interface CallbackQuery {
  id: string;
  from: { id: number };
  message?: { message_id: number; chat: { id: number } };
  data?: string;
}

/**
 * Telegram message from getUpdates
 */
interface TelegramMessage {
  message_id: number;
  from: { id: number };
  chat: { id: number };
  text?: string;
  date: number;
  reply_to_message?: { message_id: number };
}

/**
 * Event types emitted by TelegramNotifier
 */
export interface TelegramNotifierEvents {
  command: (cmd: TelegramCommand) => void;
  status_request: (chatId: number, messageId: number) => void;
  log_request: (chatId: number, messageId: number) => void;
  display_request: (chatId: number, messageId: number) => void;
  /** Text input: first select the option number, then send the text */
  text_input: (optionNumber: number, text: string) => void;
  /** Direct text send with Enter (from /send command) */
  send_text: (text: string) => void;
  /** Key input without Enter (from /key command) */
  key_input: (text: string) => void;
}

/**
 * TelegramNotifier sends notifications to Telegram and receives commands
 */
export class TelegramNotifier extends EventEmitter {
  private config: TelegramConfig;
  private projectName: string;
  private hostname: string;
  private ipAddress: string;
  private instanceId: string;
  private pollingActive = false;
  private pollingInterval: ReturnType<typeof setTimeout> | null = null;

  // Multi-instance polling: delayed offset confirmation
  private confirmedOffset = 0;
  private processedUpdateIds = new Set<number>();
  private updateFirstSeen = new Map<number, number>();
  private confirmDelayMs: number;
  private static readonly STALE_MESSAGE_THRESHOLD_S = 120;
  private static readonly MAX_PROCESSED_IDS = 5000;
  private lastNotifiedType: NotificationType | null = null;
  private lastNotifiedTime = 0;
  private static readonly NOTIFICATION_COOLDOWN_MS = 1000; // 1 second cooldown for same type

  // Stabilization delay for selection_prompt to wait for all options to render
  private pendingSelectionNotification: {
    timer: ReturnType<typeof setTimeout>;
    details?: { queueLength?: number; message?: string; options?: ParsedOption[]; context?: string };
  } | null = null;
  private static readonly SELECTION_STABILIZATION_MS = 800; // Wait for options to stabilize

  // Pending text input state (waiting for user reply after clicking text input button)
  private pendingTextInput: {
    optionNumber: number;
    messageId: number;
  } | null = null;

  // Last notification message ID (for direct reply support)
  private lastNotificationMessageId: number | null = null;

  // User-defined layout templates from config
  private templates: Record<string, string>;

  constructor(config: TelegramConfig) {
    super();
    this.config = config;
    this.confirmDelayMs = config.confirmDelayMs ?? 30000;
    this.templates = config.templates ?? {};
    this.projectName = path.basename(process.cwd());
    this.hostname = os.hostname();
    this.ipAddress = this.getLocalIpAddress();
    // Unique instance ID: hostname:PID
    this.instanceId = `${this.hostname}:${process.pid}`;
  }

  /**
   * Build Telegram API URL for a given method.
   * Centralizes URL construction to keep the bot token contained.
   */
  private apiUrl(method: string): string {
    return `https://api.telegram.org/bot${this.config.botToken}/${method}`;
  }

  emit<K extends keyof TelegramNotifierEvents>(
    event: K,
    ...args: Parameters<TelegramNotifierEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof TelegramNotifierEvents>(
    event: K,
    listener: TelegramNotifierEvents[K]
  ): this {
    return super.on(event, listener);
  }

  /**
   * Get local IP address (first non-internal IPv4)
   */
  private getLocalIpAddress(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const netInterface = interfaces[name];
      if (!netInterface) continue;
      for (const info of netInterface) {
        // Skip internal and non-IPv4 addresses
        if (!info.internal && info.family === 'IPv4') {
          return info.address;
        }
      }
    }
    return 'unknown';
  }

  /**
   * Get the unique instance ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Check if notifications are enabled and configured
   */
  isEnabled(): boolean {
    return this.config.enabled && !!this.config.botToken && !!this.config.chatId;
  }

  /**
   * Start polling for callback queries
   */
  startPolling(): void {
    if (!this.isEnabled() || this.pollingActive) {
      return;
    }

    this.pollingActive = true;
    logger.info({ instanceId: this.instanceId }, 'Telegram polling started');

    // Sequential polling: schedule next poll after current completes
    const poll = async (): Promise<void> => {
      if (!this.pollingActive) return;
      try {
        await this.pollUpdates();
      } catch (err) {
        logger.warn({ err }, 'Telegram polling error');
      }
      if (this.pollingActive) {
        this.pollingInterval = setTimeout(poll, 2000);
      }
    };
    poll();
  }

  /**
   * Stop polling for callback queries
   */
  stopPolling(): void {
    this.pollingActive = false;
    if (this.pollingInterval) {
      clearTimeout(this.pollingInterval);
      this.pollingInterval = null;
    }
    // Cancel any pending selection notification
    if (this.pendingSelectionNotification) {
      clearTimeout(this.pendingSelectionNotification.timer);
      this.pendingSelectionNotification = null;
    }
    logger.info('Telegram polling stopped');
  }

  /**
   * Poll for updates from Telegram.
   * Uses delayed offset confirmation so multiple instances sharing the same
   * bot token can each see every update within the confirmation window.
   */
  private async pollUpdates(): Promise<void> {
    if (!this.isEnabled()) return;

    const url = this.apiUrl('getUpdates');
    const now = Date.now();

    try {
      // Use confirmedOffset instead of immediately advancing — other instances
      // can still see unconfirmed updates within the delay window.
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offset: this.confirmedOffset + 1,
          timeout: 1,
          allowed_updates: ['callback_query', 'message'],
        }),
      });

      if (!response.ok) {
        return;
      }

      const data = await response.json() as {
        ok: boolean;
        result?: Array<{
          update_id: number;
          callback_query?: CallbackQuery;
          message?: TelegramMessage;
        }>;
      };

      if (!data.ok || !data.result) {
        return;
      }

      for (const update of data.result) {
        // Track first-seen time for delayed confirmation
        if (!this.updateFirstSeen.has(update.update_id)) {
          this.updateFirstSeen.set(update.update_id, now);
        }

        // Skip already-processed updates (local dedup)
        if (this.processedUpdateIds.has(update.update_id)) {
          continue;
        }
        this.processedUpdateIds.add(update.update_id);

        if (update.callback_query) {
          await this.handleCallback(update.callback_query);
        }

        if (update.message) {
          await this.handleMessage(update.message);
        }
      }

      // Advance offset only for updates old enough that all instances should have seen them
      this.advanceConfirmedOffset(now);
      this.cleanupProcessedUpdates();
    } catch {
      // Silently ignore polling errors
    }
  }

  /**
   * Advance confirmedOffset for updates older than confirmDelayMs.
   * Only advances sequentially — stops at the first update that is not old enough,
   * because offset confirmation is sequential (confirming N deletes all < N).
   */
  private advanceConfirmedOffset(now: number): void {
    const trackedIds = [...this.updateFirstSeen.keys()].sort((a, b) => a - b);

    let newOffset = this.confirmedOffset;
    for (const updateId of trackedIds) {
      if (updateId <= this.confirmedOffset) continue;

      const firstSeen = this.updateFirstSeen.get(updateId)!;
      if (now - firstSeen >= this.confirmDelayMs) {
        newOffset = updateId;
      } else {
        // Hit an update not old enough yet — can't skip over it
        break;
      }
    }

    if (newOffset > this.confirmedOffset) {
      this.confirmedOffset = newOffset;
      logger.debug({ confirmedOffset: this.confirmedOffset }, 'Telegram offset advanced');
    }
  }

  /**
   * Remove tracking entries for confirmed updates to bound memory usage.
   */
  private cleanupProcessedUpdates(): void {
    for (const updateId of this.updateFirstSeen.keys()) {
      if (updateId <= this.confirmedOffset) {
        this.updateFirstSeen.delete(updateId);
        this.processedUpdateIds.delete(updateId);
      }
    }

    // Safety cap — should not be reached under normal usage
    if (this.processedUpdateIds.size > TelegramNotifier.MAX_PROCESSED_IDS) {
      const sorted = [...this.processedUpdateIds].sort((a, b) => a - b);
      const toRemove = sorted.slice(0, sorted.length - TelegramNotifier.MAX_PROCESSED_IDS);
      for (const id of toRemove) {
        this.processedUpdateIds.delete(id);
        this.updateFirstSeen.delete(id);
      }
      logger.warn(
        { removed: toRemove.length, remaining: this.processedUpdateIds.size },
        'Trimmed processedUpdateIds due to size cap'
      );
    }
  }

  /**
   * Handle a text message (commands like /pause, /resume, /status, /send)
   * Commands can target specific instances: /pause HOSTNAME:PID
   * Also handles replies for text input flow
   */
  private async handleMessage(message: TelegramMessage): Promise<void> {
    if (!message.text) return;

    // Only process messages from the configured chat
    if (String(message.chat.id) !== this.config.chatId) {
      return;
    }

    // Skip stale messages to avoid re-processing old commands after instance restart
    const messageAge = Math.floor(Date.now() / 1000) - message.date;
    if (messageAge > TelegramNotifier.STALE_MESSAGE_THRESHOLD_S) {
      logger.debug({ messageAge, threshold: TelegramNotifier.STALE_MESSAGE_THRESHOLD_S }, 'Skipping stale Telegram message');
      return;
    }

    const text = message.text.trim();

    // Check if this is a reply to our text input request (from ✏️ button)
    if (message.reply_to_message && this.pendingTextInput) {
      if (message.reply_to_message.message_id === this.pendingTextInput.messageId) {
        const optionNumber = this.pendingTextInput.optionNumber;
        this.pendingTextInput = null;

        logger.info({ optionNumber, text }, 'Telegram text input received');
        this.emit('text_input', optionNumber, text);

        const truncatedText = text.length > 20 ? text.slice(0, 20) + '...' : text;
        await this.replyToMessage(
          message.chat.id,
          message.message_id,
          t('textinput.confirmed',{ n: optionNumber, text: truncatedText })
        );
        return;
      }
    }

    // Check if this is a reply to our last notification (direct text input)
    if (message.reply_to_message && this.lastNotificationMessageId) {
      if (message.reply_to_message.message_id === this.lastNotificationMessageId) {
        logger.info({ text }, 'Telegram direct reply to notification');
        this.emit('send_text', text);

        const truncatedReply = text.length > 20 ? text.slice(0, 20) + '...' : text;
        await this.replyToMessage(
          message.chat.id,
          message.message_id,
          t('reply.sent',{ text: truncatedReply })
        );
        return;
      }
    }

    // Parse commands - support both /cmd and /cmd@botname formats
    // Args are case-sensitive (for instance ID matching)
    const commandMatch = text.match(/^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/i);
    if (!commandMatch) return;

    const [, cmd, args] = commandMatch;
    const cmdLower = cmd.toLowerCase();

    // Handle /send command: /send [instanceId] text or /send text (with Enter)
    if (cmdLower === 'send') {
      await this.handleSendCommand(message, args);
      return;
    }

    // Handle /key command: /key [instanceId] text (without Enter)
    if (cmdLower === 'key') {
      await this.handleKeyCommand(message, args);
      return;
    }

    // For other commands, args is treated as target instance ID.
    // Routing:
    //   - No instance ID  → broadcast mode (all instances process)
    //   - Matching ID      → targeted mode (only this instance)
    //   - Non-matching ID  → skip silently
    const targetInstanceId = args?.trim();

    if (targetInstanceId && targetInstanceId !== this.instanceId) {
      logger.debug(
        { targetInstanceId, myInstanceId: this.instanceId },
        'Ignoring command for different instance'
      );
      return;
    }

    const isBroadcast = !targetInstanceId;

    switch (cmdLower) {
      case 'pause':
        logger.info({ instanceId: this.instanceId, broadcast: isBroadcast }, 'Telegram /pause command received');
        this.emit('command', 'pause');
        await this.replyToMessage(
          message.chat.id,
          message.message_id,
          isBroadcast
            ? t('cmd.paused_broadcast',{ instanceId: this.instanceId })
            : t('cmd.paused')
        );
        break;

      case 'resume':
        logger.info({ instanceId: this.instanceId, broadcast: isBroadcast }, 'Telegram /resume command received');
        this.emit('command', 'resume');
        await this.replyToMessage(
          message.chat.id,
          message.message_id,
          isBroadcast
            ? t('cmd.resumed_broadcast',{ instanceId: this.instanceId })
            : t('cmd.resumed')
        );
        break;

      case 'status':
        logger.info({ instanceId: this.instanceId, broadcast: isBroadcast }, 'Telegram /status command received');
        this.emit('status_request', message.chat.id, message.message_id);
        break;

      case 'log':
        logger.info({ instanceId: this.instanceId, broadcast: isBroadcast }, 'Telegram /log command received');
        this.emit('log_request', message.chat.id, message.message_id);
        break;

      case 'display':
        logger.info({ instanceId: this.instanceId, broadcast: isBroadcast }, 'Telegram /display command received');
        this.emit('display_request', message.chat.id, message.message_id);
        break;

      default:
        break;
    }
  }

  /**
   * Handle /send command
   * Formats: /send text, /send instanceId text
   */
  private async handleSendCommand(message: TelegramMessage, args?: string): Promise<void> {
    if (!args || args.trim().length === 0) {
      await this.replyToMessage(
        message.chat.id,
        message.message_id,
        t('cmd.send_usage')
      );
      return;
    }

    const trimmedArgs = args.trim();

    // Check if first word is an instance ID (contains colon like "hostname:pid")
    const parts = trimmedArgs.split(/\s+/);
    if (parts.length >= 2 && parts[0].includes(':')) {
      // First part might be instance ID
      const potentialInstanceId = parts[0];
      if (potentialInstanceId !== this.instanceId) {
        logger.debug(
          { targetInstanceId: potentialInstanceId, myInstanceId: this.instanceId },
          'Ignoring /send for different instance'
        );
        return;
      }
      // Rest is the text to send
      const textToSend = parts.slice(1).join(' ');
      logger.info({ text: textToSend }, 'Telegram /send command received');
      this.emit('send_text', textToSend);
      await this.replyToMessage(
        message.chat.id,
        message.message_id,
        t('cmd.sent',{ text: textToSend.length > 30 ? textToSend.slice(0, 30) + '...' : textToSend })
      );
    } else {
      // No instance ID, send to all instances (or just this one)
      logger.info({ text: trimmedArgs }, 'Telegram /send command received');
      this.emit('send_text', trimmedArgs);
      await this.replyToMessage(
        message.chat.id,
        message.message_id,
        t('cmd.sent_instance',{ instanceId: this.instanceId, text: trimmedArgs.length > 30 ? trimmedArgs.slice(0, 30) + '...' : trimmedArgs })
      );
    }
  }

  /**
   * Handle /key command (input without Enter)
   * Formats: /key text, /key instanceId text
   */
  private async handleKeyCommand(message: TelegramMessage, args?: string): Promise<void> {
    if (!args || args.trim().length === 0) {
      await this.replyToMessage(
        message.chat.id,
        message.message_id,
        t('cmd.key_usage')
      );
      return;
    }

    const trimmedArgs = args.trim();

    // Check if first word is an instance ID (contains colon like "hostname:pid")
    const parts = trimmedArgs.split(/\s+/);
    if (parts.length >= 2 && parts[0].includes(':')) {
      // First part might be instance ID
      const potentialInstanceId = parts[0];
      if (potentialInstanceId !== this.instanceId) {
        logger.debug(
          { targetInstanceId: potentialInstanceId, myInstanceId: this.instanceId },
          'Ignoring /key for different instance'
        );
        return;
      }
      // Rest is the text to send
      const textToSend = parts.slice(1).join(' ');
      logger.info({ text: textToSend }, 'Telegram /key command received');
      this.emit('key_input', textToSend);
      await this.replyToMessage(
        message.chat.id,
        message.message_id,
        t('cmd.key_sent',{ text: textToSend.length > 30 ? textToSend.slice(0, 30) + '...' : textToSend })
      );
    } else {
      // No instance ID, send to all instances (or just this one)
      logger.info({ text: trimmedArgs }, 'Telegram /key command received');
      this.emit('key_input', trimmedArgs);
      await this.replyToMessage(
        message.chat.id,
        message.message_id,
        t('cmd.key_sent_instance',{ instanceId: this.instanceId, text: trimmedArgs.length > 30 ? trimmedArgs.slice(0, 30) + '...' : trimmedArgs })
      );
    }
  }

  /**
   * Reply to a message (public for external use)
   */
  async replyToChat(chatId: number, messageId: number, text: string): Promise<void> {
    await this.replyToMessage(chatId, messageId, text);
  }

  /**
   * Reply to a message
   */
  private async replyToMessage(chatId: number, messageId: number, text: string): Promise<void> {
    const url = this.apiUrl('sendMessage');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          reply_to_message_id: messageId,
          text,
        }),
      });
      if (!response.ok) {
        logger.warn({ status: response.status, textLength: text.length }, 'Telegram reply failed');
      } else {
        logger.debug({ chatId, messageId, textLength: text.length }, 'Telegram reply sent');
      }
    } catch (error) {
      logger.warn({ error }, 'Telegram reply request failed');
    }
  }

  /**
   * Send a plain text message (for status responses)
   */
  async sendPlainMessage(text: string): Promise<void> {
    if (!this.isEnabled()) return;

    const url = this.apiUrl('sendMessage');

    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.config.chatId,
          text,
        }),
      });
    } catch (error) {
      logger.warn({ error }, 'Failed to send plain message');
    }
  }

  /**
   * Send a document file via Telegram
   * @param chatId Target chat ID
   * @param messageId Message ID to reply to
   * @param filePath Path to the file to send
   * @param caption Optional caption for the file
   */
  async sendDocument(
    chatId: number,
    messageId: number,
    filePath: string,
    caption?: string
  ): Promise<boolean> {
    if (!this.isEnabled()) return false;

    const url = this.apiUrl('sendDocument');

    try {
      const fs = await import('fs');
      const pathModule = await import('path');

      if (!fs.existsSync(filePath)) {
        logger.warn({ filePath }, 'File not found for sendDocument');
        return false;
      }

      const fileContent = fs.readFileSync(filePath);
      const fileName = pathModule.basename(filePath);

      // Use FormData for file upload
      const formData = new FormData();
      formData.append('chat_id', String(chatId));
      formData.append('reply_to_message_id', String(messageId));
      formData.append('document', new Blob([fileContent]), fileName);
      if (caption) {
        formData.append('caption', caption);
      }

      const response = await fetch(url, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        logger.warn({ status: response.status }, 'Failed to send document');
        return false;
      }

      return true;
    } catch (error) {
      logger.warn({ error, filePath }, 'Failed to send document');
      return false;
    }
  }

  /**
   * Handle a callback query from inline keyboard
   */
  private async handleCallback(query: CallbackQuery): Promise<void> {
    if (!query.data) return;

    // Only process callbacks from the configured chat
    if (!query.message || String(query.message.chat.id) !== this.config.chatId) {
      return;
    }

    // Parse callback data: "cmd:instanceId" (instanceId contains colon like "hostname:pid")
    const colonIndex = query.data.indexOf(':');
    if (colonIndex === -1) return;

    const cmd = query.data.slice(0, colonIndex);
    const targetInstanceId = query.data.slice(colonIndex + 1);

    // Only handle callbacks for this instance
    if (targetInstanceId !== this.instanceId) {
      logger.debug({ targetInstanceId, myInstanceId: this.instanceId }, 'Ignoring callback for different instance');
      return;
    }

    // Check if this is a text input button (e.g., "textinput5")
    const textInputMatch = cmd.match(/^textinput(\d+)$/);
    if (textInputMatch) {
      const optionNumber = parseInt(textInputMatch[1], 10);
      await this.answerCallback(query.id, t('textinput.callback',{ n: optionNumber }));

      // Send ForceReply message
      const forceReplyMessageId = await this.sendForceReplyMessage(
        query.message.chat.id,
        t('textinput.prompt',{ n: optionNumber })
      );

      if (forceReplyMessageId) {
        this.pendingTextInput = {
          optionNumber,
          messageId: forceReplyMessageId,
        };
        logger.info({ optionNumber }, 'Text input requested, waiting for reply');
      }

      // Update original message buttons
      await this.editMessageButtons(query.message.chat.id, query.message.message_id, `textinput${optionNumber}`);
      return;
    }

    // Acknowledge the callback
    await this.answerCallback(query.id, `✓ ${cmd}`);

    // Reset notification debounce on user interaction
    this.resetNotificationDebounce();

    // Emit command event
    const command = cmd as TelegramCommand;
    logger.info({ command, instanceId: this.instanceId }, 'Telegram command received');
    this.emit('command', command);

    // Update the message to show it was handled
    await this.editMessageButtons(query.message.chat.id, query.message.message_id, cmd);
  }

  /**
   * Send a message with ForceReply to prompt user text input
   * Returns the message ID of the sent message
   */
  private async sendForceReplyMessage(chatId: number, text: string): Promise<number | null> {
    const url = this.apiUrl('sendMessage');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
          reply_markup: {
            force_reply: true,
            selective: true,
            input_field_placeholder: t('textinput.placeholder'),
          },
        }),
      });

      if (!response.ok) {
        logger.warn({ status: response.status }, 'Failed to send ForceReply message');
        return null;
      }

      const data = await response.json() as { ok: boolean; result?: { message_id: number } };
      return data.result?.message_id ?? null;
    } catch (error) {
      logger.warn({ error }, 'Failed to send ForceReply message');
      return null;
    }
  }

  /**
   * Answer a callback query
   */
  private async answerCallback(callbackId: string, text: string): Promise<void> {
    const url = this.apiUrl('answerCallbackQuery');

    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callback_query_id: callbackId,
          text,
        }),
      });
    } catch {
      // Ignore errors
    }
  }

  /**
   * Edit message to show which button was pressed
   */
  private async editMessageButtons(chatId: number, messageId: number, selectedCmd: string): Promise<void> {
    const url = this.apiUrl('editMessageReplyMarkup');

    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          reply_markup: {
            inline_keyboard: [[{ text: `✓ ${selectedCmd}`, callback_data: 'done' }]],
          },
        }),
      });
    } catch {
      // Ignore errors
    }
  }

  /**
   * Send a notification with optional inline keyboard
   * Includes debounce to prevent duplicate notifications for same state
   * selection_prompt uses stabilization delay to wait for all options to render
   */
  async notify(
    type: NotificationType,
    details?: { queueLength?: number; message?: string; options?: ParsedOption[]; context?: string }
  ): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    // For selection_prompt, use stabilization delay to wait for all options
    if (type === 'selection_prompt') {
      // Cancel any pending notification
      if (this.pendingSelectionNotification) {
        clearTimeout(this.pendingSelectionNotification.timer);
        this.pendingSelectionNotification = null;
      }

      // Schedule notification after stabilization delay
      this.pendingSelectionNotification = {
        timer: setTimeout(async () => {
          this.pendingSelectionNotification = null;
          await this.sendSelectionNotification(details);
        }, TelegramNotifier.SELECTION_STABILIZATION_MS),
        details,
      };
      logger.debug({ optionCount: details?.options?.length }, 'Selection notification scheduled (stabilization delay)');
      return;
    }

    // Other notification types: apply debounce
    const now = Date.now();
    if (
      type === this.lastNotifiedType &&
      now - this.lastNotifiedTime < TelegramNotifier.NOTIFICATION_COOLDOWN_MS
    ) {
      logger.debug({ type, cooldownMs: TelegramNotifier.NOTIFICATION_COOLDOWN_MS }, 'Notification debounced');
      return;
    }

    this.lastNotifiedType = type;
    this.lastNotifiedTime = now;

    const message = this.formatMessage(type, details);
    const keyboard = this.getKeyboardForType(type, details?.options);
    await this.sendMessage(message, keyboard);
  }

  /**
   * Send selection notification after stabilization delay
   */
  private async sendSelectionNotification(
    details?: { queueLength?: number; message?: string; options?: ParsedOption[]; context?: string }
  ): Promise<void> {
    // Apply debounce
    const now = Date.now();
    if (
      this.lastNotifiedType === 'selection_prompt' &&
      now - this.lastNotifiedTime < TelegramNotifier.NOTIFICATION_COOLDOWN_MS
    ) {
      logger.debug('Selection notification debounced');
      return;
    }

    this.lastNotifiedType = 'selection_prompt';
    this.lastNotifiedTime = now;

    const message = this.formatMessage('selection_prompt', details);
    const keyboard = this.getKeyboardForType('selection_prompt', details?.options);
    await this.sendMessage(message, keyboard);
    logger.debug({ optionCount: details?.options?.length }, 'Selection notification sent');
  }

  /**
   * Reset notification debounce (call after user interaction)
   */
  resetNotificationDebounce(): void {
    this.lastNotifiedType = null;
    this.lastNotifiedTime = 0;
  }

  /**
   * Get inline keyboard buttons based on notification type
   * Only immediate actions related to the specific notification
   * @param options Parsed options for selection prompts
   */
  private getKeyboardForType(type: NotificationType, options?: ParsedOption[]): InlineButton[][] | null {
    switch (type) {
      case 'selection_prompt': {
        // Use actual option count, default to 4 if not parsed
        const count = Math.min(options?.length || 4, 16);
        const rows: InlineButton[][] = [];

        // Build buttons with text input detection
        const allButtons: InlineButton[] = [];
        for (let i = 1; i <= count; i++) {
          const opt = options?.find(o => o.number === i);
          const isTextInput = opt?.isTextInput ?? false;

          allButtons.push({
            text: isTextInput ? `${i}✏️` : `${i}`,
            callback_data: isTextInput
              ? `textinput${i}:${this.instanceId}`
              : `select${i}:${this.instanceId}`,
          });
        }

        // First row: options 1-8
        if (allButtons.length > 0) {
          rows.push(allButtons.slice(0, 8));
        }

        // Second row: options 9-16 if needed
        if (allButtons.length > 8) {
          rows.push(allButtons.slice(8, 16));
        }

        // Cancel button
        rows.push([
          { text: t('button.cancel'), callback_data: `escape:${this.instanceId}` },
        ]);

        return rows;
      }

      case 'breakpoint':
      case 'task_failed':
        return [
          [
            { text: '▶️ Resume', callback_data: `resume:${this.instanceId}` },
          ],
        ];

      default:
        // No buttons for interrupted, queue_started, queue_completed
        return null;
    }
  }

  /**
   * Render a template string by replacing {variable} placeholders.
   * Lines that become empty after substitution are removed.
   */
  private renderTemplate(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replaceAll(`{${key}}`, value);
    }
    return result
      .split('\n')
      .filter(line => line.trim().length > 0)
      .join('\n');
  }

  /**
   * Build template variables for a notification message.
   * All values are raw data with MarkdownV2 escaping only (no decorative emojis/formatting).
   * Type-specific variables: breakpoint→{reason}, task_failed→{error}, pty_crashed→{recovery}.
   */
  private buildTemplateVars(
    type: NotificationType,
    details?: { queueLength?: number; message?: string; options?: ParsedOption[]; context?: string }
  ): Record<string, string> {
    const title = t(`notify.${type}`);

    // Build context code block (selection_prompt only)
    let contextBlock = '';
    if (details?.context) {
      const cleanCtx = this.cleanContext(details.context);
      if (cleanCtx) {
        // Double backslashes: MarkdownV2 treats \ as escape even inside code blocks
        const escaped = cleanCtx.replace(/\\/g, '\\\\');
        contextBlock = `\`\`\`\n${escaped}\n\`\`\``;
      }
    }

    // Build options list (selection_prompt only)
    let optionsBlock = '';
    if (details?.options && details.options.length > 0) {
      optionsBlock = details.options
        .map(opt => {
          const escapedText = this.escapeMarkdown(opt.text);
          const marker = opt.isTextInput ? ' ✏️' : '';
          return `${opt.number}\\. ${escapedText}${marker}`;
        })
        .join('\n');
    }

    const vars: Record<string, string> = {
      // Common raw data variables
      title: this.escapeMarkdown(title),
      hostname: this.escapeMarkdown(this.hostname),
      ip: this.escapeMarkdown(this.ipAddress),
      instanceId: this.escapeMarkdown(this.instanceId),
      project: this.escapeMarkdown(this.projectName),
      queueLength: details?.queueLength !== undefined ? String(details.queueLength) : '',

      // Type-specific raw data variables (only the relevant one is populated)
      reason: '',
      error: '',
      recovery: '',

      // Structural variables (pre-formatted)
      context: contextBlock,
      options: optionsBlock,
    };

    // Populate the type-specific variable
    const msg = details?.message ? this.escapeMarkdown(details.message) : '';
    if (type === 'breakpoint') {
      vars.reason = msg;
    } else if (type === 'task_failed') {
      vars.error = msg;
    } else if (type === 'pty_crashed') {
      vars.recovery = msg;
    }

    return vars;
  }

  /**
   * Format notification message based on type.
   * Uses user-defined template if available, otherwise falls back to default layout.
   */
  private formatMessage(
    type: NotificationType,
    details?: { queueLength?: number; message?: string; options?: ParsedOption[]; context?: string }
  ): string {
    const vars = this.buildTemplateVars(type, details);

    // Use user template if available (type-specific or default fallback)
    const template = this.templates[type] ?? this.templates['default'];
    if (template) {
      return this.renderTemplate(template, vars);
    }

    // Selection prompt: compact layout with screen buffer only (options visible in buffer,
    // interactive selection via inline keyboard buttons)
    if (type === 'selection_prompt') {
      const lines = [
        `⚠️ *${vars.title}*  📁 ${vars.project}`,
      ];

      if (vars.context) {
        lines.push('', vars.context);
      }

      // Compact footer
      const footerParts = [`🆔 \`${vars.instanceId}\``];
      if (vars.queueLength) {
        const items = t('queue.items',{ count: vars.queueLength });
        footerParts.push(`📋 ${items}`);
      }
      lines.push('', footerParts.join(' · '));

      return lines.join('\n');
    }

    // Default layout for other notification types
    const emojiMap: Record<NotificationType, string> = {
      selection_prompt: '⚠️',
      interrupted: '🛑',
      breakpoint: '⏸️',
      queue_started: '▶️',
      queue_completed: '✅',
      task_failed: '❌',
      pty_crashed: '💥',
    };
    const emoji = emojiMap[type];

    const lines = [
      `🤖 *[qlaude]* ${emoji} *${vars.title}*`,
      '',
      `🖥️ ${vars.hostname} \\(${vars.ip}\\)`,
      `🆔 \`${vars.instanceId}\``,
      `📁 ${vars.project}`,
    ];

    if (vars.queueLength) {
      const label = t('queue.label');
      const items = t('queue.items',{ count: vars.queueLength });
      lines.push(`📋 ${label}: ${items}`);
    }

    // Type-specific message (only one will be non-empty)
    const typeMsg = vars.reason || vars.error || vars.recovery;
    if (typeMsg) {
      lines.push(`💬 ${typeMsg}`);
    }

    if (vars.context) {
      lines.push('', vars.context);
    }

    if (vars.options) {
      lines.push('', vars.options);
    }

    return lines.join('\n');
  }

  /**
   * Clean up context string: remove ANSI codes, UI chrome, and excessive whitespace
   */
  private cleanContext(context: string): string {
    // Patterns to filter out (UI chrome, not actual content)
    const filterPatterns = [
      /^[─━═╌╍┄┅┈┉\-_╯╮╰╭╗╝╚╔┐┘└┌┤├┬┴┼]{5,}$/,  // Horizontal lines and box-drawing borders (5+ chars)
      /Enter to select/i,
      /↑\/↓ to navigate/i,
      /←\/→ or tab to cycle/i,
      /Esc to cancel/i,
      /ctrl\+\w+ to/i,
      /^\s*\(\d+\/\d+\)\s*$/,  // Pagination like (1/3)
    ];

    // Remove ANSI escape codes, keep indentation and backslashes
    const cleaned = context
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')  // ANSI escape sequences
      .replace(/\r/g, '')  // Carriage returns
      .split('\n')
      .map(line => line.trimEnd())  // Keep leading whitespace (indentation)
      .filter(line => {
        if (line.length === 0) return false;
        // Filter out UI chrome lines (test against trimmed for pattern matching)
        const trimmed = line.trim();
        return !filterPatterns.some(pattern => pattern.test(trimmed));
      })
      .join('\n')
      .trim();

    return cleaned;
  }

  /**
   * Escape special characters for Telegram MarkdownV2
   * Backslashes are converted to forward slashes for cleaner paths
   */
  private escapeMarkdown(text: string): string {
    return text
      .replace(/\\/g, '/')  // Convert backslash to forward slash
      .replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  /**
   * Send message via Telegram Bot API
   * Stores message_id for direct reply support
   */
  private async sendMessage(text: string, keyboard?: InlineButton[][] | null): Promise<void> {
    const url = this.apiUrl('sendMessage');

    const body: Record<string, unknown> = {
      chat_id: this.config.chatId,
      text,
      parse_mode: 'MarkdownV2',
    };

    if (keyboard) {
      body.reply_markup = {
        inline_keyboard: keyboard,
      };
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        logger.warn({ status: response.status }, 'Telegram API error');
      } else {
        // Store message_id for direct reply support
        const data = await response.json() as { ok: boolean; result?: { message_id: number } };
        if (data.result?.message_id) {
          this.lastNotificationMessageId = data.result.message_id;
        }
        logger.debug({ type: text.substring(0, 50) }, 'Telegram notification sent');
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to send Telegram notification');
    }
  }
}
