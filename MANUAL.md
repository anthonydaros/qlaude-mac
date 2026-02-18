# qlaude Manual

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Status Bar](#status-bar)
- [Queue System](#queue-system)
- [Input Modes](#input-modes)
- [Session Management](#session-management)
- [Queue File Format](#queue-file-format)
- [Conversation Logging](#conversation-logging)
- [Telegram Integration](#telegram-integration)
- [State Detection](#state-detection)
- [Customizing Patterns](#customizing-patterns)
- [Customizing Telegram Messages](#customizing-telegram-messages)
- [Crash Recovery](#crash-recovery)
- [Keyboard Shortcuts](#keyboard-shortcuts)
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

On first run, qlaude automatically creates a `.qlaude/` directory in the current directory with config templates and an empty queue file. The directory contains:

- `.qlaude/config.json` — Common settings
- `.qlaude/patterns.json` — State detection patterns
- `.qlaude/telegram.json` — Telegram settings

Config search order: current working directory (`.qlaude/`) → home directory (`~/.qlaude/`) → defaults.

### Common Settings

Edit `.qlaude/config.json` to customize:

```json
{
  "startPaused": true,
  "idleThresholdMs": 1000,
  "requiredStableChecks": 3,
  "logLevel": "error",
  "logFile": "debug.log",
  "conversationLog": {
    "enabled": false,
    "filePath": "conversation.log",
    "timestamps": true
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `startPaused` | `true` | Start with auto-execution paused |
| `idleThresholdMs` | `1000` | Milliseconds of inactivity before analyzing screen state |
| `requiredStableChecks` | `3` | Consecutive stable screen checks required before READY |
| `logLevel` | `"error"` | Log level: trace, debug, info, warn, error, fatal, silent |
| `logFile` | — | Path to debug log file (relative to `.qlaude/` or absolute; auto-sets logLevel to debug) |
| `conversationLog.enabled` | `false` | Enable conversation logging |
| `conversationLog.filePath` | `"conversation.log"` | Log file path (relative to `.qlaude/` or absolute) |
| `conversationLog.timestamps` | `true` | Include timestamps in log |

### Telegram Settings

Edit `.qlaude/telegram.json` to customize:

```json
{
  "enabled": false,
  "botToken": "your-bot-token",
  "chatId": "your-chat-id",
  "language": "en",
  "confirmDelayMs": 30000,
  "messages": {},
  "templates": {}
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable Telegram notifications |
| `botToken` | — | Telegram Bot API token |
| `chatId` | — | Target chat ID |
| `language` | `"en"` | Message language: `"en"` (English) or `"ko"` (Korean) |
| `confirmDelayMs` | `30000` | Delay (ms) before confirming updates for multi-instance polling |
| `messages` | `{}` | Override individual message strings (keys match `telegram-messages.ts` catalog) |
| `templates` | `{}` | Per-notification-type layout templates |

### Runtime Files

The `.qlaude/` directory also holds runtime files:

- `.qlaude/queue` — Queue file
- `.qlaude/session` — Session ID file
- `.qlaude/session-labels.json` — Session labels
- `.qlaude/queue-logs/` — Per-queue execution logs
- `.qlaude/debug.log` — Debug log (when `logFile` is set)
- `.qlaude/conversation.log` — Conversation log (when enabled)

---

## Status Bar

qlaude displays a fixed status bar at the top of the terminal. The left side shows the qlaude ASCII art logo, and the right side shows queue information.

### Status Bar Content

- **Item count**: Number of items in the queue (e.g., `[3 items]`)
- **Execution state**: `[running]` or `[paused]`
- **Queue preview**: Up to 3 upcoming queue items with type tags
- **Notification messages**: Temporary messages (auto-clear after 3 seconds)

### Item Type Tags

Each queue item is displayed with a tag indicating its type:

| Tag | Meaning |
|-----|---------|
| (none) | Normal prompt |
| `[NEW]` | New session (`>>>`) |
| `[BP]` | Breakpoint (`>>#`) |
| `[ML]` | Multiline prompt |
| `[LABEL:name]` | Session label save point |
| `[LOAD:name]` | Session load point |

Tags can combine (e.g., `[ML] [NEW]` for a multiline new-session prompt).

### Toggling

Use `:status` to toggle the status bar on/off. When turned off, the scroll region is reset and Claude Code redraws the full screen.

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
| `:reload` | Reload queue from `.qlaude/queue` file |

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
- Spinner is detected on screen (safety pause)
- User manually pauses (`:pause`)

On task failure, the current item is re-added to the front of the queue for retry after `:resume`.

### Triggering Task Failure

You can intentionally stop queue execution by including `QUEUE_STOP` in Claude's output. This is useful for having Claude signal errors:

```
QUEUE_STOP
QUEUE_STOP: reason for stopping
[QUEUE_STOP] reason for stopping
```

When detected, auto-execution stops, the current item is re-added to the queue front, and a Telegram notification is sent (if enabled).

Rate limit messages (`You've hit your limit`) are also detected as task failures.

### Spinner Safety Pause

If the READY state is detected but spinner patterns are still present on screen, qlaude pauses auto-execution instead of sending the next prompt. This prevents sending prompts while Claude is still processing. Use `:resume` to continue.

### Queue Events and Notifications

During queue execution, qlaude tracks the overall queue lifecycle:

- **Queue started**: Emitted when the first item begins executing. Telegram notification sent.
- **Queue completed**: Emitted when all items have finished. Telegram notification sent.
- **Item executed**: Status bar updates after each item.

These events are independent of individual item execution — the queue lifecycle spans from the first item to the last.

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

Saves the current Claude Code session ID with the given label. Stored in `.qlaude/session-labels.json`.

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
- Labels are stored as simple `{ "label": "session-id" }` mappings in `.qlaude/session-labels.json`

---

## Queue File Format

Create `.qlaude/queue` in your project root to pre-load prompts on startup.

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
- Use `:reload` to re-read `.qlaude/queue` at runtime
- **Items are removed from `.qlaude/queue` as they execute.** If you want to reuse a queue script, save it as a separate file and copy it to `.qlaude/queue` when needed

---

## Conversation Logging

qlaude can log queue execution history and Claude Code conversations to files for review.

### Queue Execution Logs

Each queue execution creates a separate log file in `.qlaude/queue-logs/` with a timestamped filename (e.g., `queue-2026-02-18T09-30-00.log`).

The log contains:
- Queue start/completion markers with timestamps
- Each queue item as it executes (with its type: `>>`, `>>>`, `>>#`, `>>{Label:...}`, etc.)
- For multiline items, the full prompt content
- Session transitions (new session starts, session loads)
- Conversations extracted from Claude Code's JSONL session files

The `/log` Telegram command sends the most recent queue log file.

### Conversation Extraction

When `conversationLog.enabled` is `true`, qlaude extracts Q&A conversations from Claude Code's internal JSONL session files. Conversations are extracted:

- When a new session starts (before switching)
- When queue execution completes
- When the `/log` Telegram command is received

Extraction is incremental — only new conversations since the last extraction are logged, preventing duplicates.

### Configuration

Enable in `.qlaude/config.json`:

```json
{
  "conversationLog": {
    "enabled": true,
    "filePath": "conversation.log",
    "timestamps": true
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `false` | Enable conversation logging |
| `filePath` | `"conversation.log"` | Log file path (relative to `.qlaude/` or absolute) |
| `timestamps` | `true` | Include timestamps in extracted conversations |

---

## Telegram Integration

### Setup

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather)
2. Get your chat ID (send a message to your bot, then check `https://api.telegram.org/bot<TOKEN>/getUpdates`)
3. Configure in `.qlaude/telegram.json`:

```json
{
  "enabled": true,
  "botToken": "123456:ABC-DEF...",
  "chatId": "987654321"
}
```

### Notifications

qlaude sends Telegram messages when:

| Event | Description | Buttons |
|-------|-------------|---------|
| Selection prompt | Claude needs user input (permission, selection UI) | Number buttons + Cancel |
| Breakpoint | Queue reached a breakpoint | Resume |
| Queue started | Auto-execution started | — |
| Queue completed | All queue items executed | — |
| Task failed | `QUEUE_STOP` or rate limit detected | Resume |
| PTY crashed | Claude Code process crashed (auto-recovery in progress) | — |

Each notification includes the instance ID, hostname, IP address, and project name for identification.

Selection prompt notifications are debounced (800ms stabilization delay) to wait for all options to render before sending. Duplicate notifications for the same screen content are suppressed.

### Remote Commands

Send these as messages to your bot:

| Command | Description |
|---------|-------------|
| `/status INSTANCE` | Show PTY status, state, auto-execution status, and queue count |
| `/pause INSTANCE` | Pause auto-execution |
| `/resume INSTANCE` | Resume auto-execution |
| `/log INSTANCE` | Send queue log file and session conversation log as documents |
| `/display INSTANCE` | Show last 25 lines of terminal screen buffer (ANSI-cleaned, in code block) |
| `/send INSTANCE text` | Send text + Enter to Claude Code |
| `/key INSTANCE text` | Send text only, no Enter (for partial input) |

`INSTANCE` is the `HOSTNAME:PID` identifier shown in notification messages.

For `/send` and `/key`, the instance ID is optional when only one instance is running:

```
/send Fix the login bug          # No instance ID (single instance)
/send myhost:12345 Fix the bug   # With instance ID (multi-instance)
```

### Selection Response

When a selection prompt notification arrives:

- **Number buttons (1-16)**: Select that option
- **Pencil buttons (N+pencil icon)**: Select option N and type additional text (bot will ask for input via reply)
- **Cancel button**: Send Escape to cancel selection

### Text Input Detection

Options that require text input are automatically detected by matching keywords in the option text (e.g., "type", "enter", "input", "custom", "specify", "other", or text ending with `...`). These options show a pencil icon (✏️) in the Telegram buttons.

When a pencil button is pressed, the bot sends a ForceReply message asking you to type the text. Your reply is then sent as: option number → wait → text → Enter.

The text input keywords can be customized in `.qlaude/patterns.json` under `textInputKeywords`. See [Customizing Patterns](#customizing-patterns).

### Direct Reply

You can reply directly to any notification message to send text to Claude Code. The replied text is sent with Enter, equivalent to `/send text`. This is useful for quickly responding to Claude's questions without typing a full command.

### Multi-Instance

Multiple qlaude instances can share the same Telegram bot. Each instance is identified by `HOSTNAME:PID`. Commands without an instance ID target all instances (broadcast mode) for `/pause`, `/resume`, `/status`, `/log`, `/display`. For `/send` and `/key`, the first word is checked for a colon to determine if it's an instance ID.

The `confirmDelayMs` setting (default 30000ms) controls how long updates are kept visible to all instances before being confirmed. This prevents one instance from consuming an update before others can see it.

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
| INTERRUPTED | Operation was interrupted (not used for blocking/notifications due to high false positive rate) |

### Detection Priority

States are checked in this priority order (highest first):

1. **TASK_FAILED**: `QUEUE_STOP` / `[QUEUE_STOP]` markers or rate limit messages
2. **INTERRUPTED**: `^C`, `Interrupted`, `operation cancelled` (detected but does not block queue)
3. **SELECTION_PROMPT**: `[Y/n]`, `❯ N.`, `Enter to select`, numbered options
4. **READY**: No blocking patterns + screen stable for `requiredStableChecks` consecutive checks

### Detection Process

1. PTY output is fed into a headless xterm terminal emulator (xterm.js headless)
2. After `idleThresholdMs` (default 1s) of no output, the last 25 lines of screen are analyzed
3. Tip lines (containing `⎿` or `Tip:`) are filtered out to prevent false positives
4. Lines below the prompt separator (a `─` line of 10+ characters) are extracted as the analysis zone
5. Pattern matching determines the state in priority order
6. For READY, the screen must be identical for `requiredStableChecks` (default 3) consecutive checks
7. If spinner patterns are detected alongside READY conditions, `hasSpinner` metadata is set (triggers safety pause)
8. State changes trigger auto-executor actions and Telegram notifications

### Detection Patterns

qlaude uses regex patterns to detect each state. All patterns are customizable via `.qlaude/patterns.json`. See [Customizing Patterns](#customizing-patterns) for details.

**Selection prompt patterns** (default):
- `[Y/n]` or `[y/N]` — Yes/No confirmation
- `❯ N.` — Arrow cursor with numbered option
- `Enter to select · ↑/↓ to navigate` — Claude Code selection footer
- `←/→ or tab to cycle` — Tab cycling UI
- `> N. text` — Numbered option with `>` prefix

**Spinner patterns** (default):
- Unicode spinners with ellipsis (`*…`, `·…`, etc.)
- `Activating…`
- Braille dots spinners (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`)
- Circle spinners (`◐◓◑◒`)

**Task failure patterns** (default):
- `QUEUE_STOP` or `QUEUE_STOP: reason`
- `[QUEUE_STOP]` or `[QUEUE_STOP] reason`
- `You've hit your limit` (rate limit)

**Interrupted patterns** (default):
- `Interrupted`, `^C`, `operation cancelled`, `request aborted`, `was interrupted`

### Tuning

When a spinner is visible on screen, the spinner safety pause prevents premature execution regardless of timing settings. However, false READY can still occur when Claude pauses between outputs without showing a spinner (e.g., between tool calls or during long internal processing).

If false READY detections are frequent (next prompt sent while Claude is mid-task):
- Increase `idleThresholdMs` (e.g., 5000–8000) — longer silence required before analysis
- Increase `requiredStableChecks` (e.g., 5) — more consecutive stable screens required

If READY detection is too slow (noticeable delay after Claude actually finishes):
- Decrease `idleThresholdMs` (minimum recommended: 3000)
- Decrease `requiredStableChecks` (minimum 1)

---

## Customizing Patterns

All state detection patterns can be customized in `.qlaude/patterns.json`. Each pattern category can be independently configured.

### Pattern Categories

| Category | Description | Default count |
|----------|-------------|---------------|
| `selectionPrompt` | Patterns to detect selection/permission UIs | 6 patterns |
| `interrupted` | Patterns to detect interruption | 5 patterns |
| `spinner` | Patterns to detect active spinners | 7 patterns |
| `taskFailure` | Patterns to detect task failure markers | 3 patterns |
| `textInputKeywords` | Keywords for text input option detection (Telegram) | 9 patterns |
| `optionParse` | Single pattern to parse numbered options | 1 pattern |
| `tipFilter` | Substring keywords to filter tip lines | 2 keywords |
| `promptSeparator` | Pattern to detect the prompt separator line | 1 pattern |

### Override Semantics

For multi-pattern categories (`selectionPrompt`, `interrupted`, `spinner`, `taskFailure`, `textInputKeywords`):

| Config | Behavior |
|--------|----------|
| Category absent from file | Use defaults |
| `"enabled": false` | Disable the category entirely |
| `"patterns": [...]` (non-empty) | **Replace** defaults with custom patterns |
| `"patterns": []` (empty array) | Disable the category (same as `enabled: false`) |

Custom patterns **completely replace** defaults — they do not merge. If you want to add a pattern to the defaults, you must include all default patterns plus your additions.

### Pattern Entry Format

Patterns can be specified as plain strings (regex source) or objects with flags:

```json
{
  "selectionPrompt": {
    "patterns": [
      "\\[Y/n\\]",
      { "pattern": "enter to select", "flags": "i" },
      "❯\\s*\\d+\\.\\s"
    ]
  }
}
```

### Examples

**Disable spinner detection** (not recommended):

```json
{
  "spinner": {
    "enabled": false
  }
}
```

**Add a custom task failure pattern**:

```json
{
  "taskFailure": {
    "patterns": [
      "QUEUE_STOP(?::\\s*(.+?))?(?:\\n|$)",
      "\\[QUEUE_STOP\\](?:\\s*(.+?))?(?:\\n|$)",
      "You['\\u2019]ve hit your limit",
      "CUSTOM_ERROR_MARKER"
    ]
  }
}
```

**Customize text input keywords** (for Telegram pencil buttons):

```json
{
  "textInputKeywords": {
    "patterns": [
      "\\btype\\b",
      "\\benter\\b",
      "\\binput\\b",
      "\\bcustom\\b",
      "\\bspecify\\b",
      "\\bother\\b",
      "\\.{2,}$"
    ]
  }
}
```

**Customize option parsing pattern**:

```json
{
  "optionParse": {
    "pattern": "^[\\s❯>]*(\\d+)\\.\\s+(.+)$"
  }
}
```

Set `"pattern": ""` to disable option parsing.

**Customize tip line filtering**:

```json
{
  "tipFilter": {
    "keywords": ["⎿", "Tip:", "Hint:"]
  }
}
```

Set `"enabled": false` to disable tip filtering.

**Customize prompt separator**:

```json
{
  "promptSeparator": {
    "pattern": "^─+$",
    "minLength": 10
  }
}
```

---

## Customizing Telegram Messages

Telegram notification messages can be customized at two levels: individual message strings and notification layout templates.

### Message Overrides

Override individual message strings in `.qlaude/telegram.json` under `messages`. Keys match the internal message catalog. Overrides apply regardless of the `language` setting.

```json
{
  "messages": {
    "notify.queue_completed": "All done!",
    "notify.task_failed": "Something went wrong",
    "queue.items": "📋 {count} tasks remaining",
    "button.cancel": "❌ Abort"
  }
}
```

#### Available Message Keys

**Notification titles** (`notify.*`):
- `notify.selection_prompt` — Selection prompt title (default: "Input Required" / "입력 필요")
- `notify.interrupted` — Interrupted title
- `notify.breakpoint` — Breakpoint title
- `notify.queue_started` — Queue started title
- `notify.queue_completed` — Queue completed title
- `notify.task_failed` — Task failed title
- `notify.pty_crashed` — PTY crash recovery title

**Queue info** (`queue.*`):
- `queue.items` — Queue item count (placeholder: `{count}`)
- `queue.items_short` — Short queue count

**Buttons** (`button.*`):
- `button.cancel` — Cancel button text

**Command responses** (`cmd.*`):
- `cmd.paused` / `cmd.resumed` — Pause/resume confirmation
- `cmd.paused_broadcast` / `cmd.resumed_broadcast` — Broadcast versions (placeholder: `{instanceId}`)
- `cmd.instance_required` — Instance required message (placeholders: `{cmd}`, `{instanceId}`)
- `cmd.send_usage` / `cmd.key_usage` — Usage help
- `cmd.sent` / `cmd.sent_instance` — Send confirmation (placeholders: `{text}`, `{instanceId}`)
- `cmd.key_sent` / `cmd.key_sent_instance` — Key input confirmation

**Text input flow** (`textinput.*`):
- `textinput.callback` — Button click acknowledgment (placeholder: `{n}`)
- `textinput.prompt` — Reply prompt (placeholder: `{n}`)
- `textinput.placeholder` — Input field placeholder
- `textinput.confirmed` — Confirmation (placeholders: `{n}`, `{text}`)

**Status** (`status.*`):
- `status.header` — Status report header
- `status.pty_running` / `status.pty_stopped` — PTY status
- `status.pty` — PTY line (placeholder: `{status}`)
- `status.state` — State line (placeholder: `{state}`)
- `status.autoexec_paused` / `status.autoexec_active` — Auto-exec status
- `status.autoexec` — Auto-exec line (placeholder: `{status}`)

**Log** (`log.*`):
- `log.queue_caption` — Queue log caption (placeholder: `{instanceId}`)
- `log.session_caption` — Session log caption
- `log.none` — No logs message
- `log.sent` — Logs sent confirmation (placeholder: `{count}`)

**Display** (`display.*`):
- `display.empty` — Empty screen message

Message strings support `{placeholder}` interpolation. Priority: user overrides > language-specific > English fallback.

### Layout Templates

Override the entire notification layout using `templates` in `.qlaude/telegram.json`. Templates use `{variable}` placeholders.

```json
{
  "templates": {
    "selection_prompt": "{header} {emoji} {title}\n\n{hostInfo}\n{project}\n{queue}\n\n{context}\n{options}",
    "task_failed": "{emoji} {title}\n{message}\n{queue}",
    "default": "{header} {emoji} {title}\n{hostInfo}\n{project}\n{queue}\n{message}"
  }
}
```

#### Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{header}` | App header | `🤖 *[qlaude]*` |
| `{emoji}` | Event emoji | `⚠️`, `✅`, `❌`, etc. |
| `{title}` | Event title (bold) | `*Input Required*` |
| `{hostInfo}` | Hostname + IP | `🖥️ myhost (192.168.1.1)` |
| `{instanceInfo}` | Instance ID | `🆔 myhost:12345` |
| `{project}` | Project name | `📁 my-project` |
| `{queue}` | Queue item count | `📋 Queue: 3 items` |
| `{message}` | Event-specific message | `💬 reason text` |
| `{context}` | Screen context (code block) | ````...```` |
| `{options}` | Parsed options list | `1. Option one` |

Templates can be set per notification type (`selection_prompt`, `breakpoint`, `queue_started`, `queue_completed`, `task_failed`, `pty_crashed`) or as a `default` fallback. Lines that become empty after variable substitution are automatically removed.

---

## Crash Recovery

qlaude automatically recovers from Claude Code crashes during queue execution.

### PTY Crash Recovery

When the Claude Code process exits unexpectedly (non-zero exit code) during active queue execution:

1. The currently executing item is re-added to the front of the queue
2. qlaude attempts to restart Claude Code with `--resume` using the last known session ID
3. If no session ID is available, Claude Code restarts fresh
4. A Telegram notification is sent (if enabled)
5. Queue execution continues from where it left off

### Session Load Failure Recovery

When loading a saved session fails (e.g., expired or invalid session ID):

1. The PTY exits with a non-zero code
2. qlaude detects it was a session load attempt
3. The failed item is re-added to the queue front
4. Claude Code restarts fresh (without `--resume`)
5. Auto-execution pauses for user review
6. A Telegram notification is sent

### New Session Retry

When starting a new session (`>>>`) fails:

1. qlaude retries once after a 1-second delay
2. If the retry also fails, the item is re-added to the queue front
3. Auto-execution pauses
4. A Telegram notification is sent

---

## Keyboard Shortcuts

### Normal Mode

| Key | Action |
|-----|--------|
| Enter | Send current input to Claude Code |
| Backspace | Delete last character from input buffer |
| Ctrl+U | Clear the entire input buffer |
| Ctrl+C | Send interrupt signal to Claude Code (SIGINT) |
| `:` or `>` | Enter queue input mode (when input buffer is empty) |
| `>>(` | Enter multiline mode |
| `>>>(` | Enter multiline mode for new session |

### Queue Input Mode

| Key | Action |
|-----|--------|
| Enter | Execute the queue command |
| Escape | Cancel and exit queue mode |
| Backspace | Delete last character |
| Ctrl+U | Clear input buffer |

### Multiline Mode

| Key | Action |
|-----|--------|
| Enter | Add current line to buffer (or submit if line is `>>)`) |
| Backspace | Delete last character |
| Ctrl+U | Clear current line |

---

## Troubleshooting

### Enable Debug Logging

Add to `.qlaude/config.json`:

```json
{
  "logFile": "debug.log"
}
```

This automatically sets log level to debug. Check the log for state transitions, pattern matches, and screen snapshots.

### Common Issues

**Queue doesn't execute**: Check if auto-execution is paused (`:resume` to restart). Verify the status bar shows the queue count and `[running]` state.

**False READY detection**: Claude may have a long pause between outputs. Increase `idleThresholdMs` or `requiredStableChecks`.

**False SELECTION_PROMPT**: Some Claude output may match selection patterns. Check the debug log for `bufferSnapshot` to see what triggered the detection. You can customize selection prompt patterns in `.qlaude/patterns.json`.

**Spinner safety pause fires incorrectly**: Spinner patterns matched on screen content that isn't actually a spinner. Customize spinner patterns in `.qlaude/patterns.json` to exclude the false positive.

**Telegram not working**: Verify `botToken` and `chatId` in `.qlaude/telegram.json`. Check that the bot has permission to send messages to the chat. Look for Telegram errors in the debug log.

**Telegram text input buttons not appearing**: Text input detection relies on keyword matching. If your options use non-standard wording, add keywords to `textInputKeywords` in `.qlaude/patterns.json`.

**Session label not loading**: Ensure `.qlaude/session-labels.json` exists and contains the label. The session ID must be a valid Claude Code session that hasn't expired.

**Config files not generated**: If `.qlaude/` directory exists but config files are missing, they will be auto-created on the next qlaude startup. This can happen if the directory was created by queue or session operations before config initialization.

**Claude Code crashes during queue**: qlaude automatically recovers — see [Crash Recovery](#crash-recovery). Check the debug log for details on the crash and recovery process.

**Windows terminal issues**: On Windows, use [Windows Terminal](https://aka.ms/terminal) or VS Code integrated terminal. The native cmd.exe and PowerShell consoles are not supported. qlaude includes an automatic workaround for Claude Code >= 2.1.30 on Windows.
