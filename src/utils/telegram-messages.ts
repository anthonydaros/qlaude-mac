/**
 * Telegram message localization catalog
 * Supports Korean (ko) and English (en)
 */

export type Language = 'ko' | 'en';

const messages: Record<Language, Record<string, string>> = {
  ko: {
    // Notification titles
    'notify.selection_prompt': '입력 필요',
    'notify.interrupted': '작업 중단됨',
    'notify.breakpoint': 'Breakpoint 도달',
    'notify.queue_started': '큐 실행 시작',
    'notify.queue_completed': '큐 실행 완료',
    'notify.task_failed': '작업 실패',
    'notify.pty_crashed': 'Claude Code 크래시 복구',

    // Queue info
    'queue.items': '📋 큐: {count}개 항목',
    'queue.items_short': '큐: {count}개 항목',

    // Buttons
    'button.cancel': '⬅️ 취소',

    // Command responses
    'cmd.paused': '⏸️ 큐 일시정지됨',
    'cmd.resumed': '▶️ 큐 재개됨',
    'cmd.paused_broadcast': '⏸️ 큐 일시정지됨 ({instanceId})',
    'cmd.resumed_broadcast': '▶️ 큐 재개됨 ({instanceId})',
    'cmd.instance_required': '⚠️ 인스턴스 ID를 지정해주세요\n예: /{cmd} {instanceId}',
    'cmd.send_usage': '사용법: /send 텍스트 또는 /send 인스턴스ID 텍스트',
    'cmd.key_usage': '사용법: /key 텍스트 (Enter 없이 입력)',
    'cmd.sent': '📤 전송됨: "{text}"',
    'cmd.sent_instance': '📤 전송됨 ({instanceId}): "{text}"',
    'cmd.key_sent': '⌨️ 입력됨: "{text}"',
    'cmd.key_sent_instance': '⌨️ 입력됨 ({instanceId}): "{text}"',

    // Text input flow
    'textinput.callback': '✏️ {n}번 - 텍스트 입력',
    'textinput.prompt': '✏️ {n}번 선택됨\n\n입력할 텍스트를 이 메시지에 *답장*으로 보내세요:',
    'textinput.placeholder': '텍스트를 입력하세요...',
    'textinput.confirmed': '✅ {n}번 선택 + "{text}" 전송됨',

    // Direct reply
    'reply.sent': '📤 "{text}" 전송됨',

    // Status report
    'status.header': '📊 qlaude 상태',
    'status.pty_running': '✅ 실행중',
    'status.pty_stopped': '❌ 중지됨',
    'status.pty': 'PTY: {status}',
    'status.state': '상태: {state}',
    'status.autoexec_paused': '⏸️ 일시정지',
    'status.autoexec_active': '▶️ 활성화',
    'status.autoexec': '자동실행: {status}',

    // Log request
    'log.queue_caption': '📋 큐 로그 ({instanceId})',
    'log.session_caption': '💬 세션 로그',
    'log.none': '📭 전송할 로그가 없습니다',
    'log.sent': '✅ {count}개 로그 전송 완료',

    // Display request
    'display.empty': '📭 화면 버퍼가 비어있습니다',
  },
  en: {
    // Notification titles
    'notify.selection_prompt': 'Input Required',
    'notify.interrupted': 'Interrupted',
    'notify.breakpoint': 'Breakpoint Reached',
    'notify.queue_started': 'Queue Started',
    'notify.queue_completed': 'Queue Completed',
    'notify.task_failed': 'Task Failed',
    'notify.pty_crashed': 'Claude Code Crash Recovery',

    // Queue info
    'queue.items': '📋 Queue: {count} items',
    'queue.items_short': 'Queue: {count} items',

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
  },
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
 * Priority: user overrides > language-specific > Korean fallback > raw key.
 */
export function t(key: string, lang: Language, params?: Record<string, string | number>): string {
  let msg = userOverrides[key] ?? messages[lang]?.[key] ?? messages['en'][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      msg = msg.replaceAll(`{${k}}`, String(v));
    }
  }
  return msg;
}
