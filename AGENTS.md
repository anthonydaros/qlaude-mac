# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What is qlaude?

A Node.js/TypeScript CLI wrapper around Codex that spawns it in a PTY, detects its idle/ready state, and automatically feeds queued prompts one by one. Key integrations: Telegram remote control, session save/load, batch mode for CI/CD.

## Commands

```bash
npm run build          # Compile with tsup → dist/
npm run dev            # Watch mode (tsup --watch)
npm run test           # Run Vitest once
npm run test:watch     # Vitest in watch mode
npm run test:coverage  # Coverage report (v8)
npm run lint           # ESLint on src/
npm run format         # Prettier on src/
```

Run a single test file:
```bash
npx vitest run tests/unit/queue-manager.test.ts
```

## Architecture

The app follows an event-driven pattern. All core components are EventEmitters wired together in `src/main.ts`.

### Data flow
```
Queue file → QueueManager (parse) → AutoExecutor
  → waits for StateDetector to emit READY
  → PtyWrapper.write(prompt)
  → Display updates status bar
  → Telegram sends notification
```

### Core modules

| File | Role |
|------|------|
| `src/main.ts` | Orchestrator: wires all components, manages hooks and Telegram |
| `src/auto-executor.ts` | Watches for READY state, pops queue and writes prompts; emits `executed`, `queue_completed`, `task_failed`, `breakpoint` |
| `src/state-detector.ts` | Analyzes PTY output via idle-based detection + regex pattern matching; emits state changes (`PROCESSING`, `READY`, `SELECTION_PROMPT`, `INTERRUPTED`, `TASK_FAILED`) |
| `src/pty-wrapper.ts` | Wraps `node-pty` to spawn/resize/restart Codex in a pseudo-terminal |
| `src/queue-manager.ts` | Persistent queue in `.qlaude/queue` (plain text); supports `@directive` lines and bare prompts |
| `src/input-parser.ts` | Parses interactive commands (`:add`, `:pause`, `:resume`, `:save`, `:load`, `:reload`, etc.) |
| `src/display.ts` | Renders the status bar UI in the terminal |
| `src/patterns/state-patterns.ts` | Regex patterns for state detection; user-overridable via `.qlaude/patterns.json` |

### Utilities (`src/utils/`)

- `telegram.ts` — Telegram Bot API integration (notifications + inline button responses)
- `config.ts` — Loads `.qlaude/config.json`
- `logger.ts` — Pino-based JSON logger
- `conversation-logger.ts` — Records session conversations
- `session-log-extractor.ts` — Reads Codex session logs
- `pattern-compiler.ts` — Compiles custom user patterns from config

### Bin scripts

- `src/bin/setup-hooks.ts` → `qlaude-setup-hooks` (runs on `postinstall`)
- `src/bin/session-hook.ts` → `qlaude-session-hook` (Codex hook)
- `src/bin/remove-hooks.ts` → `qlaude-remove-hooks` (runs on `preuninstall`)

### Key types (`src/types/`)

- `QueueItem` — A single queued prompt with directives (`isNewSession`, `labelSession`, `resumeSessionId`, `delayMs`, `modelName`, `isBreakpoint`)
- `ClaudeCodeState` — Current state with `type: StateType` and timestamp
- `QlaudeConfig` — Runtime config shape loaded from `.qlaude/config.json`

## Runtime config

`.qlaude/` directory (git-ignored) holds runtime state:
- `config.json` — User configuration
- `queue` — Active prompt queue (plain text)
- `patterns.json` — Optional pattern overrides for state detection
- `sessions/` — Saved session labels

## Module system

The project uses ESM (`"type": "module"` in package.json). All imports must use `.js` extensions when referencing local files (TypeScript resolves them at compile time). `tsup` bundles four entry points and outputs to `dist/`.
