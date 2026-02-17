# qlaude Manual

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Queue System](#queue-system)
- [Input Modes](#input-modes)
- [Session Management](#session-management)
- [Queue File Format](#queue-file-format)
- [Telegram Integration](#telegram-integration)
- [State Detection](#state-detection)
- [Troubleshooting](#troubleshooting)

---

## Installation

```bash
npm install -g qlaude@alpha
```

Requirements:
- Node.js >= 20.0.0
- Claude Code CLI installed and authenticated

After installation, qlaude automatically sets up Claude Code hooks for session tracking. On uninstall, hooks are cleaned up automatically.

### Running

```bash
qlaude                 # Start with default settings
qlaude --resume        # Resume last Claude Code session
qlaude --model opus    # Pass any Claude Code arguments
```

All arguments after `qlaude` are forwarded directly to Claude Code.

---

## Configuration

On first run, qlaude automatically creates `.qlauderc.json` (config template) and `.qlaude-queue` (empty queue file) in the current directory if they don't exist.

Edit `.qlauderc.json` to customize settings:

```json
{
  "startPaused": false,
  "idleThresholdMs": 5000,
  "requiredStableChecks": 2,
  "logLevel": "error",
  "logFile": ".qlaude-debug.log",
  "conversationLog": {
    "enabled": true,
    "filePath": ".qlaude-conversation.log",
    "timestamps": true
  },
  "telegram": {
    "enabled": false,
    "botToken": "your-bot-token",
    "chatId": "your-chat-id",
    "language": "ko"
  }
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `startPaused` | `false` | Start with auto-execution paused |
| `idleThresholdMs` | `5000` | Milliseconds of inactivity before analyzing screen state |
| `requiredStableChecks` | `2` | Consecutive stable screen checks required before READY |
| `logLevel` | `"error"` | Log level: trace, debug, info, warn, error, fatal, silent |
| `logFile` | — | Path to debug log file (auto-sets logLevel to debug) |
| `conversationLog.enabled` | `false` | Enable conversation logging |
| `conversationLog.filePath` | `".qlaude-conversation.log"` | Log file path |
| `conversationLog.timestamps` | `true` | Include timestamps in log |
| `telegram.enabled` | `false` | Enable Telegram notifications |
| `telegram.botToken` | — | Telegram Bot API token |
| `telegram.chatId` | — | Target chat ID |
| `telegram.language` | `"ko"` | Telegram message language: `"ko"` (Korean) or `"en"` (English) |

---

## Queue System

The queue holds prompts that are automatically executed one by one when Claude finishes processing.

### Adding to Queue

| Command | Description |
|---------|-------------|
| `>> prompt` | Add prompt to queue |
| `>>> prompt` | Add prompt, start new Claude session first |
| `>># comment` | Add breakpoint (pauses auto-execution) |
| `>>#` | Add breakpoint without comment |

### Removing from Queue

| Command | Description |
|---------|-------------|
| `<<` | Remove last item from queue |

### Meta Commands

| Command | Description |
|---------|-------------|
| `:pause` | Pause auto-execution |
| `:resume` | Resume auto-execution |
| `:status` | Toggle status bar visibility |
| `:reload` | Reload queue from `.qlaude-queue` file |

### Execution Flow

1. Claude finishes a task (READY state detected)
2. Auto-executor pops the next item from the queue
3. Prompt is sent to Claude Code via PTY
4. Wait for Claude to finish, repeat

Execution pauses when:
- Queue is empty
- Breakpoint is reached
- Claude shows a selection prompt (permission, file picker, etc.)
- Task failure is detected (`QUEUE_STOP` marker or rate limit)
- User manually pauses (`:pause`)

On task failure, the current item is re-added to the front of the queue for retry after `:resume`.

---

## Input Modes

### Normal Mode

Type normally — input is buffered and sent to Claude Code on Enter.

### Queue Input Mode

Press `:` or `>` when the input buffer is empty to enter queue input mode. A `[Q]` prompt appears at the bottom of the terminal.

- **Enter**: Execute the queue command
- **Escape**: Cancel and exit queue mode
- **Backspace**: Delete last character
- **Ctrl+U**: Clear input buffer

### Multiline Mode

For multi-line prompts:

```
>>(
Line 1 of your prompt
Line 2 of your prompt
Line 3 of your prompt
>>)
```

- Start with `>>(` (or `>>>(` for new session)
- Each line is buffered with a `[ML N]` indicator
- End with `>>)` to submit
- Whitespace and indentation are preserved

---

## Session Management

### Saving Sessions

```
>>{Label:name}
```

Saves the current Claude Code session ID with the given label. Stored in `.qlaude-session-labels.json`.

### Loading Sessions

```
>>{Load:name}
```

Restarts Claude Code and resumes the saved session.

```
>>>{Load:name} prompt
```

Loads the session and queues a prompt to execute after resuming.

### How It Works

- Claude Code session IDs are captured via a session hook installed at setup
- Session IDs are cached in memory to avoid file read race conditions
- Labels are stored as simple `{ "label": "session-id" }` mappings in `.qlaude-session-labels.json`

---

## Queue File Format

Create `.qlaude-queue` in your project root to pre-load prompts on startup.

### Syntax

```
# Each line is a prompt (lines starting with >> prefix are optional)
Fix the login bug
>> Refactor the auth module

# New session
>>> Start fresh with a new task

# Multiline prompt
>>(
Write a function that:
- Takes a list of numbers
- Returns the sorted unique values
>>)

# Breakpoint
>># Review changes before continuing

# Session management
>>{Label:checkpoint-1}
>>>{Load:previous-work} Continue where we left off
```

### Rules

- Empty lines and lines starting with `#` (comments) are ignored
- `>>` prefix is optional for simple prompts
- `>>>` marks the prompt to run in a new Claude session
- `>>(` ... `>>)` wraps multiline prompts (preserves whitespace)
- `>>>(` ... `>>)` wraps multiline prompts for new session
- `>>#` sets a breakpoint
- `>>{Label:name}` / `>>{Load:name}` manage sessions
- Use `:reload` to re-read the file at runtime
- **Items are removed from `.qlaude-queue` as they execute.** If you want to reuse a queue script, save it as a separate file and copy it to `.qlaude-queue` when needed

---

## Telegram Integration

### Setup

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather)
2. Get your chat ID (send a message to your bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)
3. Configure in `.qlauderc.json`:

```json
{
  "telegram": {
    "enabled": true,
    "botToken": "123456:ABC-DEF...",
    "chatId": "987654321"
  }
}
```

### Notifications

qlaude sends Telegram messages when:

| Event | Description |
|-------|-------------|
| Selection prompt | Claude needs user input (permission, selection UI) |
| Breakpoint | Queue reached a breakpoint |
| Queue started | Auto-execution started |
| Queue completed | All queue items executed |
| Task failed | `QUEUE_STOP` or rate limit detected |

Selection prompt notifications include inline keyboard buttons for remote response.

### Remote Commands

Send these as messages to your bot:

| Command | Description |
|---------|-------------|
| `/status INSTANCE` | Show queue status and current state |
| `/pause INSTANCE` | Pause auto-execution |
| `/resume INSTANCE` | Resume auto-execution |
| `/log INSTANCE` | Download queue log and session log |
| `/display INSTANCE` | Show current terminal screen buffer |
| `/send INSTANCE text` | Send text + Enter to Claude |
| `/key INSTANCE text` | Send text only (no Enter) |

`INSTANCE` is the `HOSTNAME:PID` identifier shown in notification messages.

### Selection Response

When a selection prompt notification arrives:

- **Number buttons (1-16)**: Select that option
- **Pencil buttons (N+pencil icon)**: Select option N and type additional text (bot will ask for input via reply)
- **Cancel button**: Send Escape to cancel selection

### Multi-Instance

Multiple qlaude instances can share the same Telegram bot. Each instance is identified by `HOSTNAME:PID`. Commands without an instance ID are ignored if multiple instances are running.

---

## State Detection

qlaude monitors Claude Code's terminal output to determine its state.

### States

| State | Description |
|-------|-------------|
| PROCESSING | Claude is generating output |
| READY | Claude is waiting for input |
| SELECTION_PROMPT | Claude is showing a selection UI |
| TASK_FAILED | `QUEUE_STOP` marker or rate limit detected |
| INTERRUPTED | Operation was interrupted (not used for blocking/notifications) |

### Detection Process

1. PTY output is fed into a headless xterm terminal emulator
2. After `idleThresholdMs` (default 5s) of no output, the screen is analyzed
3. Pattern matching determines the state:
   - Spinner patterns (Unicode spinners + `...`) → still PROCESSING
   - `QUEUE_STOP` / rate limit → TASK_FAILED
   - `[Y/n]`, `Enter to select`, numbered options → SELECTION_PROMPT
   - No blocking patterns + stable screen (`requiredStableChecks` consecutive identical reads) → READY
4. State changes trigger auto-executor actions and Telegram notifications

### Tuning

If qlaude triggers READY too early (while Claude is still thinking):
- Increase `idleThresholdMs` (e.g., 8000)
- Increase `requiredStableChecks` (e.g., 3)

If qlaude is too slow to detect READY:
- Decrease `idleThresholdMs` (minimum recommended: 3000)

---

## Troubleshooting

### Enable Debug Logging

Add to `.qlauderc.json`:

```json
{
  "logFile": ".qlaude-debug.log"
}
```

This automatically sets log level to debug. Check the log for state transitions, pattern matches, and screen snapshots.

### Common Issues

**Queue doesn't execute**: Check if auto-execution is paused (`:resume` to restart). Verify the status bar shows the queue count.

**False READY detection**: Claude may have a long pause between outputs. Increase `idleThresholdMs` or `requiredStableChecks`.

**False SELECTION_PROMPT**: Some Claude output may match selection patterns. Check the debug log for `bufferSnapshot` to see what triggered the detection.

**Telegram not working**: Verify `botToken` and `chatId` in config. Check that the bot has permission to send messages to the chat. Look for Telegram errors in the debug log.

**Session label not loading**: Ensure `.qlaude-session-labels.json` exists and contains the label. The session ID must be a valid Claude Code session that hasn't expired.
