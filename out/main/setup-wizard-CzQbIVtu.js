import "readline";
import "fs";
import "path";
import "os";
import "./main.js";
async function validateBotToken(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const data = await res.json();
    if (data.ok && data.result?.username) {
      return data.result.username;
    }
    return null;
  } catch {
    return null;
  }
}
async function detectChatId(token) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getUpdates?limit=100`);
    const data = await res.json();
    if (data.ok && data.result && data.result.length > 0) {
      for (let i = data.result.length - 1; i >= 0; i--) {
        const update = data.result[i];
        for (const value of Object.values(update)) {
          if (value && typeof value === "object" && "chat" in value && value.chat?.id) {
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
export {
  detectChatId,
  validateBotToken
};
