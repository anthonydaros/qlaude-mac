<p align="center">
  <img src="https://raw.githubusercontent.com/starsh2001/qlaude/main/assets/logo.png" alt="qlaude" width="360">
</p>

<p align="center">
  <strong>Queue your work. Live your life.</strong><br>
  Claude Code wrapper with queue-based prompt automation and Telegram remote control.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/qlaude"><img src="https://img.shields.io/npm/v/qlaude" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/qlaude"><img src="https://img.shields.io/npm/dm/qlaude" alt="npm downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/starsh2001/qlaude" alt="license"></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/starsh2001/qlaude/main/assets/anim.gif" alt="qlaude demo" width="720">
</p>

---

## What is qlaude?

qlaude wraps Claude Code in a PTY, monitors its state in real-time, and **automatically executes queued prompts** when Claude is ready. Stack up tasks, walk away, get notified on Telegram.

```
Queue File                    Terminal                      Your Phone
┌──────────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│ @model sonnet    │     │ [1/5] [running]     │     │                  │
│ Create user API  │     │                     │     │  📱 Telegram     │
│ @new             │ ──▶ │ Claude is working...│ ──▶ │  "Input needed"  │
│ Write tests      │     │                     │     │  [Allow] [Deny]  │
│ @model opus      │     │                     │     │                  │
│ Review & fix     │     │ Queue completed ✓   │     │  ✅ Responded    │
└──────────────────┘     └─────────────────────┘     └──────────────────┘
```

### Key Features

- **Queue-based prompt automation** — Write prompts in a file, qlaude feeds them to Claude one by one
- **Telegram remote control** — Get notified on permission prompts, respond with inline buttons from your phone
- **Session save / load** — Name and resume long-running Claude conversations
- **Batch mode** — Run queue files non-interactively for CI/CD pipelines
- **Interactive commands** — `:add`, `:pause`, `:resume`, `:reload`, and more while running
- **Customizable state detection** — Override detection patterns via `.qlaude/patterns.json`

---

## Quick Start

```bash
# Install
npm install -g qlaude@alpha

# Run (in your project directory)
qlaude
```

---

## Requirements

- **Node.js** 20.19 or later
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** installed and authenticated
- **Windows**: Use [Windows Terminal](https://aka.ms/terminal) or VS Code integrated terminal

## Documentation

For full usage guide, configuration, Telegram setup, queue file syntax, and more:

**[Read the Manual →](MANUAL.md)**

## Operations

### Telegram Smoke

- Isolate the smoke run with disposable `HOME` and workspace directories.
- Put `botToken` and `chatId` in the disposable `~/.qlaude/telegram.json`, then enable Telegram in the disposable workspace.
- Run `cd "$SMOKE_WORKSPACE" && HOME="$SMOKE_HOME" qlaude`, then verify `/status`, `/display`, and `/log`.

Step-by-step guide: [Manual Smoke Checklist](MANUAL.md#manual-smoke-checklist)

### Troubleshooting

- Missing `/log` attachment, wrong `chatId`, or expired token:
  use the troubleshooting block in [MANUAL.md](MANUAL.md#manual-smoke-checklist).

### Token Rotation

- If a token was exposed in chat, screenshots, or logs, rotate it immediately in
  [@BotFather](https://t.me/BotFather) before reusing the bot.

## License

MIT
