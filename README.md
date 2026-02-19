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

---

## Table of Contents

- [Quick Start](#quick-start)
- [CLI Usage](#cli-usage)
- [Interactive Commands](#interactive-commands)
- [Queue File](#queue-file)
- [Configuration](#configuration)
- [Telegram Setup](#telegram-setup)
- [Session Management](#session-management)
- [Batch Mode](#batch-mode)
- [Pattern Customization](#pattern-customization)
- [How It Works](#how-it-works)
- [Requirements](#requirements)

---

## Quick Start

```bash
# Install
npm install -g qlaude@alpha

# Run (in your project directory)
qlaude
```

qlaude launches Claude Code with all enhanced features enabled. All standard Claude Code flags pass through:

```bash
qlaude --resume              # Resume last session
qlaude --model opus          # Use specific model
qlaude --no-auto-updates     # Disable auto-updates
```

---

## CLI Usage

```
qlaude [claude-flags] [qlaude-flags]
```

### qlaude-specific flags

| Flag | Description |
|------|-------------|
| `---run` | Batch mode: execute queue then exit |
| `---file <path>` | Load queue from file (use with `---run`) |

All other flags are forwarded to Claude Code as-is.

### Examples

```bash
# Normal interactive use
qlaude

# Resume the last Claude session
qlaude --resume

# Batch: run a task file and exit with report
qlaude ---run ---file tasks.txt

# Batch with a specific model
qlaude --model sonnet ---run ---file tasks.txt
```

---

## Interactive Commands

While qlaude is running, press `:` at the start of a line to enter command mode.

### Queue Commands

| Command | Description |
|---------|-------------|
| `:add <prompt>` | Add a prompt to the end of the queue |
| `:drop` | Remove the last item from the queue |
| `:clear` | Clear all items from the queue |
| `:list` | Show queue contents with index numbers |
| `:reload` | Reload queue from `.qlaude/queue` file |

### Execution Control

| Command | Description |
|---------|-------------|
| `:pause` | Pause auto-execution (queue items are preserved) |
| `:resume` | Resume auto-execution |

### Session Commands

| Command | Description |
|---------|-------------|
| `:save <label>` | Save current session under a named label |
| `:load <label>` | Resume a previously saved session |
| `:model <name>` | Switch Claude Code model (e.g., `sonnet`, `opus`) |

### Display Commands

| Command | Description |
|---------|-------------|
| `:status` | Toggle the status bar overlay |
| `:help` | Show in-terminal command reference |

### Multiline Input

Use `:(` and `:)` to enter a multiline prompt:

```
:(
Create a REST API with the following endpoints:
- POST /users - user registration
- POST /auth/login - login and return JWT
- GET /users/me - authenticated user profile
- DELETE /users/:id - admin only

Use Express, add input validation, and write JSDoc comments.
:)
```

The entire block is queued as a single prompt.

---

## Queue File

Create `.qlaude/queue` in your project directory to pre-load prompts. The file is read on startup and can be reloaded with `:reload`.

### Basic Example

```
Implement user authentication with JWT
Write unit tests for all auth endpoints
Update README with API documentation
```

Each non-empty, non-directive line becomes one queue item.

### Directives

Directives start with `@` and control execution flow.

| Directive | Description |
|-----------|-------------|
| `@new` | Restart Claude Code as a new session |
| `@model <name>` | Switch model before the next prompt |
| `@pause [reason]` | Pause queue (manual breakpoint) |
| `@delay <ms>` | Wait N milliseconds before next item |
| `@save <label>` | Save session with label after current item completes |
| `@load <label>` | Resume a saved session (restarts Claude Code) |
| `@( ... @)` | Multiline prompt block |

### Advanced Example

```
# Phase 1: scaffolding with a fast model
@model sonnet
Set up a new Express project with TypeScript, ESLint, and Prettier

@new
@model sonnet
Implement CRUD endpoints for /users with PostgreSQL using pg

# Phase 2: review with a stronger model
@new
@model opus
Review the entire codebase for security vulnerabilities and fix them

@save after-review

# Phase 3: documentation
@new
@model sonnet
Write comprehensive README with all API endpoints and examples

@pause Check README before continuing

@new
@model sonnet
Add OpenAPI/Swagger documentation to all endpoints
```

### Multiline Blocks in Queue File

```
@(
Create a REST API with the following requirements:
- Node.js + Express + TypeScript
- PostgreSQL with connection pooling
- JWT authentication middleware
- Rate limiting on all public routes
- Request validation with zod
@)
```

---

## Configuration

On first run, qlaude creates a `.qlaude/` directory with config templates.

### Directory Structure

```
.qlaude/
├── config.json           # Core settings
├── patterns.json         # State detection patterns (optional override)
├── telegram.json         # Telegram credentials
├── queue                 # Queue file (optional)
├── session               # Current session ID (written by hook)
├── session-labels.json   # Saved session label → ID mappings
├── debug.log             # Debug log (if enabled)
├── batch-report.json     # Batch mode report
└── conversation-logs/
    └── queue-YYYY-MM-DD.jsonl
```

### config.json

```json
{
  "startPaused": true,
  "idleThresholdMs": 1000,
  "requiredStableChecks": 3,
  "logLevel": "error",
  "logFile": "debug.log",
  "conversationLog": {
    "enabled": false,
    "filePath": "conversation-logs/queue.jsonl",
    "timestamps": true
  }
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `startPaused` | boolean | `true` | If `true`, auto-execution is paused on startup. Set to `false` to auto-start the queue. |
| `idleThresholdMs` | number | `1000` | Milliseconds of output silence before checking Claude's state. |
| `requiredStableChecks` | number | `3` | Number of consecutive idle checks with no screen change before transitioning to READY. |
| `logLevel` | string | `"error"` | Pino log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`. |
| `logFile` | string | `"debug.log"` | Log file path, relative to `.qlaude/`. |
| `conversationLog.enabled` | boolean | `false` | Enable JSONL conversation logging. |
| `conversationLog.filePath` | string | `"conversation-logs/queue.jsonl"` | Log file path, relative to `.qlaude/`. |
| `conversationLog.timestamps` | boolean | `true` | Include ISO timestamps in log entries. |

### telegram.json

```json
{
  "enabled": true,
  "botToken": "123456789:ABCdef...",
  "chatId": "987654321",
  "language": "en",
  "confirmDelayMs": 30000
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enabled` | boolean | `false` | Enable Telegram notifications. |
| `botToken` | string | — | Telegram Bot API token from [@BotFather](https://t.me/BotFather). |
| `chatId` | string | — | Your Telegram chat ID. Send a message to your bot, then call `getUpdates` to find it. |
| `language` | string | `"en"` | Notification language. Supported: `en`, `ko`. |
| `confirmDelayMs` | number | `30000` | Multi-instance polling offset in milliseconds. Used to prevent duplicate responses when running multiple qlaude instances. |

---

## Telegram Setup

Telegram integration lets you monitor and control qlaude from your phone.

### 1. Create a Bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the **bot token**

### 2. Find Your Chat ID

1. Send any message to your new bot
2. Open this URL in a browser (replace `TOKEN`):
   ```
   https://api.telegram.org/botTOKEN/getUpdates
   ```
3. Find `"chat":{"id":YOUR_CHAT_ID}` in the response

### 3. Configure qlaude

Edit `.qlaude/telegram.json`:

```json
{
  "enabled": true,
  "botToken": "123456789:ABCdef-your-token-here",
  "chatId": "987654321",
  "language": "en"
}
```

### Telegram Commands

Send these commands to your bot while qlaude is running:

| Command | Description |
|---------|-------------|
| `/status` | Show queue length, current state, and auto-execution status |
| `/pause` | Pause auto-execution |
| `/resume` | Resume auto-execution |
| `/log` | Get recent conversation log |
| `/display` | Get current terminal screen content |
| `/send <text>` | Send text + Enter to Claude |
| `/key <text>` | Send text to Claude without Enter |

When a **selection prompt** appears (e.g., "Allow this action?"), qlaude sends inline buttons to your phone. Tap to respond without opening your laptop.

### Multi-Instance Support

Running qlaude in multiple projects simultaneously? Each instance registers itself as `hostname:PID`. When a selection prompt fires, all instances are notified but only the originating instance acts on your response. The `confirmDelayMs` setting adds a delay so you can distinguish which instance sent a notification.

---

## Session Management

Save and resume Claude Code sessions by name to continue long-running conversations.

### Save a Session

```
:save my-feature-branch
```

Or in a queue file:

```
@save my-feature-branch
```

The current session ID is recorded under the label `my-feature-branch` in `.qlaude/session-labels.json`.

### Resume a Session

```
:load my-feature-branch
```

Or in a queue file:

```
@load my-feature-branch
```

qlaude restarts Claude Code with `--resume <sessionId>`, continuing the conversation.

### How Session IDs Are Tracked

qlaude installs a `SessionStart` hook into Claude Code (`~/.claude/settings.json`). When Claude starts a session, the hook writes the session ID to `.qlaude/session`. Labels map to these IDs.

The hook is installed automatically on `npm install -g qlaude` and removed on uninstall.

---

## Batch Mode

Run a queue file non-interactively — useful for CI/CD pipelines or scripts.

```bash
qlaude ---run ---file tasks.txt
```

- Loads the queue from `tasks.txt`
- Sets `startPaused: false` (auto-executes immediately)
- Exits with code `0` on success or `1` on failure
- Writes a report to `.qlaude/batch-report.json`

### Batch Report

```json
{
  "status": "completed",
  "reason": "Queue finished",
  "itemsExecuted": 5,
  "totalItems": 5,
  "timestamp": "2025-02-19T10:30:00.000Z"
}
```

| Field | Description |
|-------|-------------|
| `status` | `"completed"` or `"failed"` |
| `reason` | Human-readable description |
| `itemsExecuted` | Number of prompts sent to Claude |
| `totalItems` | Total items in the original queue |
| `timestamp` | ISO 8601 completion time |

### CI/CD Example

```yaml
# GitHub Actions
- name: Run Claude tasks
  run: |
    npx qlaude@alpha ---run ---file .qlaude/ci-tasks.txt
  env:
    # Claude Code auth handled separately
```

---

## Pattern Customization

qlaude detects Claude's state by analyzing terminal output with regex patterns. You can override the defaults in `.qlaude/patterns.json`.

### Available Patterns

| Key | Purpose |
|-----|---------|
| `selectionPrompt` | Detect selection menus / permission prompts |
| `interrupted` | Detect when Claude was interrupted |
| `spinner` | Detect active processing spinners |
| `taskFailure` | Detect explicit `QUEUE_STOP` failure markers |
| `textInputKeywords` | Detect text input prompts |
| `optionParse` | Parse option numbers from selection menus |
| `tipFilter` | Filter out `Tip:` lines to avoid false positives |
| `promptSeparator` | Filter the prompt input separator |

### Example Override

```json
{
  "selectionPrompt": "(?:Do you want to|Allow|Deny|Yes|No|\\[y/n\\])",
  "spinner": "(?:⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏|Thinking|Working)"
}
```

Patterns use JavaScript regex syntax. Only specify keys you want to override; omitted keys use defaults.

---

## How It Works

```
PTY Output → Terminal Emulator → State Detector → Auto Executor → PTY Input
              (xterm headless)     (idle timer +      (FIFO queue pop
                                    screen analysis)   + prompt write)
```

1. **PTY Wrapper** — qlaude spawns Claude Code in a pseudo-terminal, capturing all I/O bidirectionally.
2. **Terminal Emulator** — xterm headless maintains a faithful screen buffer, parsing ANSI escape sequences so state analysis works on rendered output, not raw bytes.
3. **State Detector** — After `idleThresholdMs` ms of silence, the detector analyzes the screen buffer. It classifies Claude's state as one of: `PROCESSING`, `READY`, `SELECTION_PROMPT`, `INTERRUPTED`, or `TASK_FAILED`. The READY state requires `requiredStableChecks` consecutive stable screens to avoid false triggers.
4. **Auto Executor** — On every `READY` transition, it pops the next queue item and writes it to the PTY. Directives (`@new`, `@model`, `@save`, etc.) are handled before the prompt is sent.
5. **Display** — A 5-line status bar at the bottom shows queue position, current item, state, and auto-execution status. It is drawn as an overlay and never interferes with Claude's output.
6. **Crash Recovery** — If Claude Code crashes, qlaude attempts to restart it (up to 3 times), optionally resuming the last session. After 3 consecutive crashes it stops retrying.

### State Machine

```
           output arrives
READY ──────────────────────────▶ PROCESSING
  ▲                                    │
  │              idle timeout          │
  └────────────────────────────────────┘
  │    (spinner detected → stay PROCESSING)
  │
  │    selection detected
  └──────────────────────────────▶ SELECTION_PROMPT
  │
  │    interruption detected
  └──────────────────────────────▶ INTERRUPTED
  │
  │    QUEUE_STOP marker detected
  └──────────────────────────────▶ TASK_FAILED
```

---

## Requirements

- **Node.js** 20 or later
- **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** installed and authenticated
- **Windows**: Use [Windows Terminal](https://aka.ms/terminal) or VS Code integrated terminal

## License

MIT
