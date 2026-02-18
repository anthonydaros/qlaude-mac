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

## Features

### Queue System

Add prompts to a queue that executes automatically when Claude finishes each task:

| Command | Description |
|---------|-------------|
| `>> prompt` | Add prompt to queue |
| `>>> prompt` | Add prompt as new session |
| `>>#` or `>># comment` | Add breakpoint (pauses execution) |
| `<<` | Remove last item from queue |

Enter queue input mode by pressing `:` or `>` when the prompt is empty.

### Multiline Prompts

```
>>(
First line of prompt
Second line of prompt
>>)
```

Use `>>>(` for multiline with new session.

### Session Labels

Save and restore Claude Code sessions by name:

```
>>{Label:my-feature}          # Save current session
>>{Load:my-feature}           # Resume saved session
>>>{Load:my-feature} prompt   # Resume + execute prompt
```

### Queue File

Pre-load prompts by creating `.qlaude/queue` in your project root:

```
First prompt to execute
>>> Start new session for this prompt
>>(
Multiline
prompt here
>>)
>># Pause here for review
>>{Label:checkpoint}
```

### Meta Commands

| Command | Description |
|---------|-------------|
| `:pause` | Pause auto-execution |
| `:resume` | Resume auto-execution |
| `:status` | Toggle status bar |
| `:reload` | Reload queue from file |

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
