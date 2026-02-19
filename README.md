# qlaude

Claude Code wrapper with queue-based prompt automation and remote control.

qlaude wraps Claude Code in a PTY (pseudo-terminal), monitors its state in real-time, and automatically executes queued prompts when Claude is ready. Includes Telegram integration for remote monitoring and control.

## Requirements

- Node.js 20.x or higher
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed and configured
- **Windows**: Use [Windows Terminal](https://aka.ms/terminal) or VS Code integrated terminal (cmd.exe/PowerShell native console not supported)

## Installation

```bash
npm install -g qlaude@alpha
```

## Quick Start

```bash
qlaude
```

This launches Claude Code with qlaude's enhanced features. All Claude Code arguments are passed through:

```bash
qlaude --resume        # Resume last session
qlaude --model opus    # Use specific model
```

### Batch Mode

qlaude uses triple-dash (`---`) prefix for its own flags (avoids collision with Claude Code flags):

```bash
qlaude ---run                      # Execute queue and auto-exit
qlaude ---file tasks.txt           # Load queue file and start
qlaude ---run ---file tasks.txt    # Load, execute, and exit with report
```

In batch mode (`---run`), qlaude auto-exits when the queue completes (exit 0) or fails (exit 1), and writes a report to `.qlaude/batch-report.json`.

## Features

### Queue System

Add prompts to a queue that executes automatically when Claude finishes each task:

| Command | Description |
|---------|-------------|
| `:add prompt` | Add prompt to queue |
| `:add @directive` | Add `@new`, `@pause`, `@save`, `@load`, `@model`, `@delay` to queue |
| `:drop` | Remove last item from queue |
| `:clear` | Clear all queue items |
| `:help` | Show command reference |
| `:list` | Show queue contents |

Enter queue input mode by pressing `:` when the prompt is empty.

### Multiline Prompts

```
:(
First line of prompt
Second line of prompt
:)
```

### Session Management

Save and restore Claude Code sessions by name:

```
:save my-feature              # Save current session (immediate)
:load my-feature              # Resume saved session (immediate)
```

### Queue File

Pre-load prompts by creating `.qlaude/queue` in your project root:

```
# Comments start with #
First prompt to execute
@new
Start new session for this prompt
@(
Multiline
prompt here
@)
@pause Pause here for review
@save checkpoint
@model sonnet
@delay 3000
```

Note: queue files use `@` prefix directives (not `:`). `:` commands are interactive only. All directives are case-insensitive.

### Meta Commands

| Command | Description |
|---------|-------------|
| `:pause` | Pause auto-execution |
| `:resume` | Resume auto-execution |
| `:status` | Toggle status bar |
| `:reload` | Reload queue from file |
| `:help` | Show command reference |
| `:list` | Show queue contents |
| `:model name` | Switch Claude Code model (sends `/model`) |

### Telegram Integration

Remote monitoring and control via Telegram bot. Configure in `.qlaude/telegram.json`:

```json
{
  "enabled": true,
  "botToken": "your-bot-token",
  "chatId": "your-chat-id",
  "language": "en"
}
```

Features:
- Notifications when Claude needs input (permission prompts, selection UI)
- Inline keyboard buttons for remote selection
- Remote commands: `/status`, `/pause`, `/resume`, `/log`, `/display`, `/send`, `/key`
- Multi-instance support via `HOSTNAME:PID` targeting
- Message language: English (`"en"`, default) or Korean (`"ko"`)

### Configuration

On first run, qlaude auto-creates a `.qlaude/` directory with config templates (`config.json`, `patterns.json`, `telegram.json`) and an empty queue file. Edit `.qlaude/config.json` to customize:

```json
{
  "startPaused": true,
  "idleThresholdMs": 1000,
  "requiredStableChecks": 3,
  "logLevel": "error",
  "logFile": "debug.log",
  "conversationLog": {
    "enabled": false
  }
}
```

See [MANUAL.md](MANUAL.md) for detailed documentation.

For a sample queue file that tests all features, see [examples/sample-queue.txt](examples/sample-queue.txt).

## How It Works

1. qlaude spawns Claude Code in a PTY and captures all terminal output
2. A terminal emulator (xterm headless) maintains the screen buffer
3. A state detector analyzes the screen to determine Claude's state (READY, PROCESSING, SELECTION_PROMPT, etc.)
4. When READY is detected, the auto-executor pops the next item from the queue and sends it to the PTY
5. The cycle repeats until the queue is empty

## License

MIT
