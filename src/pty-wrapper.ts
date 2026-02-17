import { EventEmitter } from 'events';
import * as pty from 'node-pty';
import type { IPty } from 'node-pty';
import { logger } from './utils/logger.js';
import type { PtyWrapperEvents } from './types/pty.js';
import { buildPtySpawnArgs } from './utils/cli-args.js';
import { PtyError, ErrorCode } from './types/errors.js';

export class PtyWrapper extends EventEmitter {
  private pty: IPty | null = null;
  private isRestarting: boolean = false;

  emit<K extends keyof PtyWrapperEvents>(
    event: K,
    ...args: Parameters<PtyWrapperEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof PtyWrapperEvents>(
    event: K,
    listener: PtyWrapperEvents[K]
  ): this {
    return super.on(event, listener);
  }

  spawn(claudeArgs: string[]): void {
    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 30;

    const { shell, args } = buildPtySpawnArgs(claudeArgs);

    try {
      // Use actual terminal type from environment, fallback to xterm-256color
      const termName = process.env.TERM || 'xterm-256color';
      logger.debug({ termName, cols, rows }, 'Spawning PTY with terminal type');

      this.pty = pty.spawn(shell, args, {
        name: termName,
        cols,
        rows,
        cwd: process.cwd(),
        env: process.env as Record<string, string>,
        // Let node-pty use default PTY (ConPTY on Windows 10+)
      });

      this.pty.onData((data: string) => {
        this.emit('data', data);
      });

      this.pty.onExit(({ exitCode, signal }) => {
        this.pty = null;
        // Don't emit exit event during restart - it's expected
        if (this.isRestarting) {
          logger.debug('PTY exit during restart, not propagating');
          return;
        }
        if (exitCode !== 0) {
          const error = new PtyError(
            `PTY exited with code ${exitCode}${signal ? ` (signal: ${signal})` : ''}`,
            ErrorCode.PTY_UNEXPECTED_EXIT,
            false
          );
          logger.error({ error, exitCode, signal }, 'PTY unexpected exit');
        }
        this.emit('exit', exitCode, signal);
      });

      logger.debug({ cols, rows, shell, args }, 'PTY spawned');
    } catch (error) {
      logger.error({ error }, 'PTY spawn failed');
      throw error;
    }
  }

  write(data: string): void {
    if (this.pty) {
      this.pty.write(data);
    }
  }

  resize(cols: number, rows: number): void {
    if (this.pty) {
      this.pty.resize(cols, rows);
      logger.debug({ cols, rows }, 'Terminal resized');
    }
  }

  kill(): void {
    if (this.pty) {
      this.pty.kill();
      this.pty = null;
    }
  }

  isRunning(): boolean {
    return this.pty !== null;
  }

  /**
   * Gracefully restart PTY session
   * Kills existing PTY, waits for exit, then spawns new PTY
   *
   * @param claudeArgs - CLI arguments for new PTY session
   * @throws Error if spawn fails after restart
   */
  async restart(claudeArgs: string[]): Promise<void> {
    if (!this.isRunning()) {
      // No existing PTY, just spawn
      this.spawn(claudeArgs);
      return;
    }

    // Set flag to prevent exit event propagation to main.ts
    this.isRestarting = true;

    return new Promise((resolve, reject) => {
      const currentPty = this.pty!;

      // Listen for node-pty exit directly (not our wrapper event)
      currentPty.onExit(() => {
        this.pty = null;
        this.isRestarting = false;

        try {
          this.spawn(claudeArgs);
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      // Kill the current PTY
      currentPty.kill();
    });
  }
}
