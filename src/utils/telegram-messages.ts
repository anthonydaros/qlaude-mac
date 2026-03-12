/**
 * Telegram message catalog (English only)
 */

export const messages: Record<string, string> = {
  // Notification titles
  'notify.selection_prompt': 'Input Required',
  'notify.interrupted': 'Interrupted',
  'notify.breakpoint': 'Breakpoint Reached',
  'notify.queue_started': 'Queue Started',
  'notify.queue_completed': 'Queue Completed',
  'notify.task_failed': 'Task Failed',
  'notify.pty_crashed': 'Claude Code Crash Recovery',

  // Queue info
  'queue.label': 'Queue',
  'queue.items': '{count} items',

  // Buttons
  'button.cancel': '⬅️ Cancel',

  // Command responses
  'cmd.paused': '⏸️ Queue paused',
  'cmd.resumed': '▶️ Queue resumed',
  'cmd.paused_broadcast': '⏸️ Queue paused ({instanceId})',
  'cmd.resumed_broadcast': '▶️ Queue resumed ({instanceId})',
  'cmd.instance_required': '⚠️ Please specify instance ID\nExample: /{cmd} {instanceId}',
  'cmd.send_usage': 'Usage: /send text or /send instanceId text',
  'cmd.key_usage': 'Usage: /key text (input without Enter)',
  'cmd.sent': '📤 Sent: "{text}"',
  'cmd.sent_instance': '📤 Sent ({instanceId}): "{text}"',
  'cmd.key_sent': '⌨️ Input: "{text}"',
  'cmd.key_sent_instance': '⌨️ Input ({instanceId}): "{text}"',

  // Text input flow
  'textinput.callback': '✏️ #{n} - text input',
  'textinput.prompt': '✏️ #{n} selected\n\nPlease *reply* to this message with the text to send:',
  'textinput.placeholder': 'Enter text...',
  'textinput.confirmed': '✅ #{n} selected + "{text}" sent',

  // Direct reply
  'reply.sent': '📤 "{text}" sent',

  // Status report
  'status.header': '📊 qlaude Status',
  'status.pty_running': '✅ Running',
  'status.pty_stopped': '❌ Stopped',
  'status.pty': 'PTY: {status}',
  'status.state': 'State: {state}',
  'status.autoexec_paused': '⏸️ Paused',
  'status.autoexec_active': '▶️ Active',
  'status.autoexec': 'Auto-exec: {status}',

  // Log request
  'log.queue_caption': '📋 Queue log ({instanceId})',
  'log.session_caption': '💬 Session log',
  'log.none': '📭 No logs to send',
  'log.sent': '✅ {count} logs sent',

  // Display request
  'display.empty': '📭 Screen buffer is empty',
};

/**
 * User-provided message overrides from config.
 * These take priority over built-in messages.
 */
let userOverrides: Record<string, string> = {};

/**
 * Set message overrides from config (called once at startup)
 */
export function setMessageOverrides(overrides: Record<string, string>): void {
  userOverrides = overrides;
}

/**
 * Get a localized message by key with optional parameter interpolation.
 * Priority: user overrides > built-in messages > raw key.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let msg = userOverrides[key] ?? messages[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replaceAll(`{${k}}`, String(v));
    }
  }
  return msg;
}
