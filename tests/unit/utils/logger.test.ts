import { beforeEach, describe, expect, it, vi } from 'vitest';

const registry = vi.hoisted(() => ({
  pino: vi.fn(),
  destination: vi.fn(),
}));

vi.mock('pino', () => ({
  default: Object.assign(registry.pino, {
    destination: registry.destination,
  }),
}));

async function loadSubject() {
  vi.resetModules();
  registry.pino.mockReset();
  registry.destination.mockReset();

  registry.destination.mockImplementation((file: string) => ({ file }));
  registry.pino.mockImplementation((options: unknown, target?: unknown) => ({
    options,
    target,
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }));

  return import('../../../src/utils/logger.js');
}

describe('logger', () => {
  beforeEach(() => {
    delete process.env.LOG_LEVEL;
  });

  it('should create a pretty logger by default and forward proxy calls', async () => {
    const subject = await loadSubject();
    const initialLogger = registry.pino.mock.results[0]?.value as { info: ReturnType<typeof vi.fn> };

    subject.logger.info('hello');

    expect(registry.pino).toHaveBeenCalledWith({
      level: 'error',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
        },
      },
    });
    expect(initialLogger.info).toHaveBeenCalledWith('hello');
  });

  it('should use file destination after reconfigureLogger and respect explicit level', async () => {
    const subject = await loadSubject();
    const nextLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
    registry.pino.mockReturnValueOnce(nextLogger);

    subject.reconfigureLogger('/tmp/qlaude.log', 'warn');
    subject.logger.warn('saved');

    expect(registry.destination).toHaveBeenCalledWith('/tmp/qlaude.log');
    expect(registry.pino).toHaveBeenLastCalledWith(
      {
        level: 'warn',
      },
      { file: '/tmp/qlaude.log' }
    );
    expect(nextLogger.warn).toHaveBeenCalledWith('saved');
  });

  it('should fall back to LOG_LEVEL env when log level is not provided', async () => {
    process.env.LOG_LEVEL = 'trace';
    const subject = await loadSubject();
    const envLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
    registry.pino.mockReturnValueOnce(envLogger);

    subject.reconfigureLogger('/tmp/from-env.log');
    subject.logger.error('failure');

    expect(registry.pino).toHaveBeenLastCalledWith(
      {
        level: 'trace',
      },
      { file: '/tmp/from-env.log' }
    );
    expect(envLogger.error).toHaveBeenCalledWith('failure');
  });
});
