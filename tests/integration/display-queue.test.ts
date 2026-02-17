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
    // Given
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    queueManager.on('item_added', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    // When
    await queueManager.addItem('Test prompt');

    // Then
    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[1 item]');
    expect(output).toContain('Test prompt');
  });

  it('should update status bar when item is removed', async () => {
    // Given
    vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    await queueManager.reload();

    // Clear mock calls from reload
    mockWrite.mockClear();

    queueManager.on('item_removed', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    // When
    await queueManager.removeLastItem();

    // Then
    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[1 item]');
  });

  it('should update status bar when queue is reloaded', async () => {
    // Given
    vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2\nprompt3');

    queueManager.on('queue_reloaded', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    // When
    await queueManager.reload();

    // Then
    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[3 items]');
  });

  it('should show new session marker after adding new session item', async () => {
    // Given
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    queueManager.on('item_added', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    // When
    await queueManager.addItem('New session prompt', true);

    // Then
    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[NEW]');
    expect(output).toContain('New session prompt');
  });

  it('should update status bar with multiple items after reload', async () => {
    // Given
    vi.mocked(fs.readFile).mockResolvedValue('prompt1\n>>> session2\nprompt3');

    queueManager.on('queue_reloaded', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    // When
    await queueManager.reload();

    // Then
    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[3 items]');
    expect(output).toContain('prompt1');
    expect(output).toContain('[NEW]');
    expect(output).toContain('session2');
    expect(output).toContain('prompt3');
  });

  it('should show empty queue after removing all items', async () => {
    // Given
    vi.mocked(fs.readFile).mockResolvedValue('single prompt');
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    await queueManager.reload();

    queueManager.on('item_removed', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    // Clear mock calls from reload
    mockWrite.mockClear();

    // When
    await queueManager.removeLastItem();

    // Then
    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[empty]');
  });

  // Story 2.7: Status Bar Toggle tests
  it('should not render status bar when disabled but queue operations work', async () => {
    // Given
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    display.toggle(); // disable
    mockWrite.mockClear(); // clear any calls from toggle

    queueManager.on('item_added', () => {
      display.updateStatusBar(queueManager.getItems());
    });

    // When
    await queueManager.addItem('Test prompt');

    // Then - queue should have the item
    expect(queueManager.getLength()).toBe(1);
    // Status bar should not render (display disabled)
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('should render status bar immediately when toggled on', async () => {
    // Given
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    // Add item while display is disabled
    display.toggle(); // disable
    await queueManager.addItem('Test prompt');
    mockWrite.mockClear();

    // When - toggle display back on
    display.toggle(); // enable
    display.updateStatusBar(queueManager.getItems());

    // Then
    expect(mockWrite).toHaveBeenCalled();
    const output = mockWrite.mock.calls.map((c) => c[0]).join('');
    expect(output).toContain('[1 item]');
  });
});
