import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Display } from '../../src/display.js';
import { QueueManager } from '../../src/queue-manager.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const TEST_QUEUE_FILE = '/tmp/test-queue';

describe('Display + QueueManager integration', () => {
  let display: Display;
  let queueManager: QueueManager;
  let mockWrite: ReturnType<typeof vi.spyOn>;
  const originalColumns = process.stdout.columns;
  const originalRows = process.stdout.rows;

  beforeEach(() => {
    vi.resetAllMocks();
    display = new Display();
    queueManager = new QueueManager(TEST_QUEUE_FILE);
    mockWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Object.defineProperty(process.stdout, 'columns', { value: 80, writable: true });
    Object.defineProperty(process.stdout, 'rows', { value: 30, writable: true });
  });

  afterEach(() => {
    mockWrite.mockRestore();
    Object.defineProperty(process.stdout, 'columns', { value: originalColumns, writable: true });
    Object.defineProperty(process.stdout, 'rows', { value: originalRows, writable: true });
  });

  it('should update status bar when item is added', async () => {
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    queueManager.on('item_added', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    await queueManager.addItem('Test prompt');

    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[1 item]');
    expect(output).toContain('Test prompt');
  });

  it('should update status bar when item is removed', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    await queueManager.reload();

    mockWrite.mockClear();

    queueManager.on('item_removed', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    await queueManager.removeLastItem();

    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[1 item]');
  });

  it('should update status bar when queue is reloaded', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2\nprompt3');

    queueManager.on('queue_reloaded', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    await queueManager.reload();

    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[3 items]');
  });

  it('should show [New Session] marker for @new items from queue file', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('prompt1\n@new\nprompt2');

    queueManager.on('queue_reloaded', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    await queueManager.reload();

    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[3 items]');
    expect(output).toContain('prompt1');
    expect(output).toContain('[New Session]');
    expect(output).toContain('prompt2');
  });

  it('should show [New Session] marker when new session is added via addItem', async () => {
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    queueManager.on('item_added', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    await queueManager.addItem('', { isNewSession: true });

    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[New Session]');
  });

  it('should show [PAUSE] marker for @pause items from queue file', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('prompt1\n@pause check here');

    queueManager.on('queue_reloaded', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    await queueManager.reload();

    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[PAUSE]');
    expect(output).toContain('check here');
  });

  it('should show empty queue after removing all items', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('single prompt');
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    await queueManager.reload();

    queueManager.on('item_removed', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    mockWrite.mockClear();

    await queueManager.removeLastItem();

    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[empty]');
  });

  // Status bar toggle tests
  it('should not render status bar when disabled but queue operations work', async () => {
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    display.toggle(); // disable
    mockWrite.mockClear();

    queueManager.on('item_added', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    await queueManager.addItem('Test prompt');

    expect(queueManager.getLength()).toBe(1);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('should render status bar immediately when toggled on', async () => {
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    display.toggle(); // disable
    await queueManager.addItem('Test prompt');
    mockWrite.mockClear();

    display.toggle(); // enable
    display.updateStatusBar(queueManager.getItems());

    expect(mockWrite).toHaveBeenCalled();
    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[1 item]');
  });
});
