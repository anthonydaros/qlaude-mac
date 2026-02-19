/**
 * First-run setup wizard for qlaude.
 * Interactive prompts for language selection and Telegram configuration.
 * Does NOT write any files — returns collected data for the caller to persist.
 */

import { createInterface, type Interface as ReadlineInterface } from 'readline';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { QLAUDE_DIR, detectLanguage } from './config.js';
import type { Language } from './telegram-messages.js';

export interface WizardResult {
  language: Language;
  telegram?: {
    enabled: boolean;
    botToken: string;
    chatId?: string;
  };
}

interface WizardMessages {
  welcome: string;
  langPrompt: string;
  telegramAsk: string;
  tokenPrompt: string;
  tokenValid: string;
  tokenInvalid: string;
  tokenRetry: string;
  chatIdDetecting: string;
  chatIdPrompt: string;
  chatIdFound: string;
  chatIdNotFound: string;
  done: string;
  skipped: string;
}

const wizardMessages: Record<Language, WizardMessages> = {
  ko: {
    welcome: '\n=== qlaude 설정 ===\n',
    langPrompt: '언어 선택 (1: English, 2: 한국어)',
    telegramAsk: '텔레그램 알림을 설정하시겠습니까? (y/N)',
    tokenPrompt: '봇 토큰',
    tokenValid: '✓ 봇: @{name}',
    tokenInvalid: '✗ 유효하지 않은 토큰',
    tokenRetry: '다시 입력하시겠습니까? (y/N)',
    chatIdDetecting: 'Chat ID 감지 중...',
    chatIdPrompt: '텔레그램 앱에서 @{name} 봇에게 /start 또는 아무 메시지를 보내세요\n  자동 감지 대기 중... (Ctrl+C로 취소)',
    chatIdFound: '✓ Chat ID: {id}',
    chatIdNotFound: '✗ 메시지를 찾지 못했습니다. 나중에 telegram.json에서 설정해주세요.',
    done: '\n✓ 설정 완료! .qlaude/ 디렉토리에서 설정을 수정할 수 있습니다.\n',
    skipped: '텔레그램은 나중에 .qlaude/telegram.json에서 설정할 수 있습니다.\n',
  },
  en: {
    welcome: '\n=== qlaude Setup ===\n',
    langPrompt: 'Select language (1: English, 2: 한국어)',
    telegramAsk: 'Setup Telegram notifications? (y/N)',
    tokenPrompt: 'Bot token',
    tokenValid: '✓ Bot: @{name}',
    tokenInvalid: '✗ Invalid token',
    tokenRetry: 'Try again? (y/N)',
    chatIdDetecting: 'Detecting Chat ID...',
    chatIdPrompt: 'Open Telegram and send /start or any message to @{name}\n  Waiting for message... (Ctrl+C to cancel)',
    chatIdFound: '✓ Chat ID: {id}',
    chatIdNotFound: '✗ Could not find message. Set chat ID manually in telegram.json.',
    done: '\n✓ Setup complete! You can modify settings in .qlaude/ directory.\n',
    skipped: 'Telegram can be configured later in .qlaude/telegram.json.\n',
  },
};

/**
 * Prompt user for input via readline.
 * Resolves with empty string if readline closes (e.g. Ctrl+C).
 */
function prompt(rl: ReadlineInterface, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
    // Resolve on close to prevent hanging when user presses Ctrl+C
    rl.once('close', () => resolve(''));
  });
}

/**
 * Validate a Telegram bot token via getMe API.
 * Returns bot username on success, null on failure.
 */
export async function validateBotToken(token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json() as { ok: boolean; result?: { username?: string } };
    if (data.ok && data.result?.username) {
      return data.result.username;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect chat ID by polling getUpdates for the most recent update.
 * Checks message, my_chat_member, and other update types for chat ID.
 * Returns chat ID string on success, null if no updates found.
 */
export async function detectChatId(token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=100`);
    const data = await res.json() as {
      ok: boolean;
      result?: Array<Record<string, { chat?: { id?: number } }>>;
    };
    if (data.ok && data.result && data.result.length > 0) {
      // Search from newest to oldest, check all update types for chat.id
      for (let i = data.result.length - 1; i >= 0; i--) {
        const update = data.result[i];
        for (const value of Object.values(update)) {
          if (value && typeof value === 'object' && 'chat' in value && value.chat?.id) {
            return String(value.chat.id);
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Update telegram.json with the given fields (merge with existing content).
 */
export function updateTelegramConfig(fields: Record<string, unknown>): void {
  const configPath = join(process.cwd(), QLAUDE_DIR, 'telegram.json');
  let existing: Record<string, unknown> = {};
  try {
    existing = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    // File may not exist or be invalid — start fresh
  }
  const merged = { ...existing, ...fields };
  writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

/**
 * Run the first-run setup wizard.
 * Collects language and optional Telegram configuration in memory.
 * Returns WizardResult on success, null if cancelled (Ctrl+C).
 * Does NOT write any files — caller is responsible for persisting results.
 */
export async function runSetupWizard(): Promise<WizardResult | null> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Track Ctrl+C cancellation (not normal rl.close() calls)
  let cancelled = false;
  rl.on('SIGINT', () => {
    cancelled = true;
    rl.close();
  });

  try {
    // Determine initial display language from system locale
    const detectedLang = detectLanguage();
    let lang: Language = detectedLang;
    let msg = wizardMessages[lang];

    console.log(msg.welcome);

    // Step 1: Language selection
    const langChoice = await prompt(rl, msg.langPrompt, detectedLang === 'ko' ? '2' : '1');
    if (cancelled) return null;

    if (langChoice === '2') {
      lang = 'ko';
    } else {
      lang = 'en';
    }
    msg = wizardMessages[lang];

    const result: WizardResult = { language: lang };

    // Step 2: Telegram setup (optional)
    const setupTelegram = await prompt(rl, msg.telegramAsk, 'N');
    if (cancelled) return null;

    if (setupTelegram.toLowerCase() !== 'y') {
      console.log(msg.skipped);
      return result;
    }

    // Step 3: Bot token input + validation
    let botUsername: string | null = null;
    let botToken = '';

    while (!botUsername) {
      botToken = await prompt(rl, msg.tokenPrompt);
      if (cancelled) return null;
      if (!botToken) {
        console.log(msg.skipped);
        return result;
      }

      botUsername = await validateBotToken(botToken);
      if (botUsername) {
        console.log(msg.tokenValid.replace('{name}', botUsername));
      } else {
        console.log(msg.tokenInvalid);
        const retry = await prompt(rl, msg.tokenRetry, 'N');
        if (cancelled) return null;
        if (retry.toLowerCase() !== 'y') {
          console.log(msg.skipped);
          return result;
        }
      }
    }

    result.telegram = { enabled: true, botToken };

    // Step 4: Chat ID detection — try existing updates first, then poll
    console.log(msg.chatIdDetecting);
    let chatId = await detectChatId(botToken);

    if (!chatId) {
      // No existing updates — ask user to send a message, poll automatically
      console.log(msg.chatIdPrompt.replace('{name}', botUsername));
      const POLL_INTERVAL_MS = 2000;
      const MAX_POLLS = 30; // 60 seconds total
      for (let i = 0; i < MAX_POLLS && !cancelled; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        chatId = await detectChatId(botToken);
        if (chatId) break;
      }
    }

    if (cancelled) return null;

    if (chatId) {
      console.log(msg.chatIdFound.replace('{id}', chatId));
      result.telegram.chatId = chatId;
    } else {
      console.log(msg.chatIdNotFound);
    }

    console.log(msg.done);
    return result;
  } finally {
    rl.close();
  }
}
