import pino from 'pino';
import type { LogLevel } from '../types/config.js';

let currentLogger = createLogger();

function createLogger(logFile?: string, logLevel?: LogLevel): pino.Logger {
  if (logFile) {
    return pino(
      {
        level: logLevel || process.env.LOG_LEVEL || 'debug',
      },
      pino.destination(logFile)
    );
  }

  return pino({
    level: logLevel || process.env.LOG_LEVEL || 'error',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  });
}

/**
 * Reconfigure logger with new settings
 * Call this after loading config from .qlaude/config.json
 */
export function reconfigureLogger(logFile?: string, logLevel?: LogLevel): void {
  currentLogger = createLogger(logFile, logLevel);
}

/**
 * Logger proxy that forwards to currentLogger
 * This allows reconfiguration after initial import
 */
export const logger: pino.Logger = new Proxy({} as pino.Logger, {
  get(_target, prop: keyof pino.Logger) {
    return currentLogger[prop];
  },
});
