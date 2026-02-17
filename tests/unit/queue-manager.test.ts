import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

describe('QueueManager', () => {
  let queueManager: QueueManager;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    queueManager = new QueueManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should use default file path .qlaude/queue', () => {
      // Given/When
      const manager = new QueueManager();

      // Then
      expect(manager['filePath']).toBe('.qlaude/queue');
    });

    it('should accept custom file path', () => {
      // Given/When
      const manager = new QueueManager('/custom/path/.queue');

      // Then
      expect(manager['filePath']).toBe('/custom/path/.queue');
    });
  });

  describe('addItem', () => {
    it('should add regular prompt to queue', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // When
      await queueManager.addItem('test prompt');

      // Then
      const items = queueManager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].prompt).toBe('test prompt');
      expect(items[0].isNewSession).toBe(false);
    });

    it('should add new session marker to queue', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // When
      await queueManager.addItem('new session prompt', true);

      // Then
      const items = queueManager.getItems();
      expect(items[0].isNewSession).toBe(true);
    });

    it('should set addedAt date when adding item', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      const now = new Date('2026-01-28T12:00:00Z');
      vi.setSystemTime(now);

      // When
      await queueManager.addItem('test prompt');

      // Then
      const items = queueManager.getItems();
      expect(items[0].addedAt).toEqual(now);
    });

    it('should serialize concurrent addItem calls without losing data', async () => {
      // Given - use real timers to model async write interleaving
      vi.useRealTimers();
      let fileContent = '';
      let writeCount = 0;

      vi.mocked(fs.readFile).mockImplementation(async () => fileContent);
      vi.mocked(fs.writeFile).mockImplementation(async (_path, content) => {
        writeCount++;
        // Delay first write so a race would overwrite newer content without locking
        if (writeCount === 1) {
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        fileContent = String(content);
      });

      // When
      await Promise.all([
        queueManager.addItem('first'),
        queueManager.addItem('second'),
      ]);

      // Then
      expect(fileContent).toBe('first\nsecond');
      expect(queueManager.getItems().map(i => i.prompt)).toEqual(['first', 'second']);
    });
  });

  describe('removeLastItem', () => {
    it('should remove and return last item', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.reload();

      // When
      const removed = await queueManager.removeLastItem();

      // Then
      expect(removed?.prompt).toBe('prompt2');
      expect(queueManager.getLength()).toBe(1);
    });

    it('should return null when queue is empty', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      // When
      const removed = await queueManager.removeLastItem();

      // Then
      expect(removed).toBeNull();
    });
  });

  describe('getNextItem', () => {
    it('should return first item without removing it', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      await queueManager.reload();

      // When
      const item = queueManager.getNextItem();

      // Then
      expect(item?.prompt).toBe('prompt1');
      expect(queueManager.getLength()).toBe(2);
    });

    it('should return null when queue is empty', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      await queueManager.reload();

      // When
      const item = queueManager.getNextItem();

      // Then
      expect(item).toBeNull();
    });
  });

  describe('popNextItem', () => {
    it('should remove and return first item', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.reload();

      // When
      const item = await queueManager.popNextItem();

      // Then
      expect(item?.prompt).toBe('prompt1');
      expect(queueManager.getLength()).toBe(1);
      expect(queueManager.getNextItem()?.prompt).toBe('prompt2');
    });

    it('should return null when queue is empty', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      // When
      const item = await queueManager.popNextItem();

      // Then
      expect(item).toBeNull();
    });
  });

  describe('parseQueueFile (via reload)', () => {
    it('should parse regular prompts', async () => {
      // Given
      const content = 'prompt1\nprompt2\nprompt3';
      vi.mocked(fs.readFile).mockResolvedValue(content);

      // When
      await queueManager.reload();

      // Then
      const items = queueManager.getItems();
      expect(items).toHaveLength(3);
      expect(items.every((i) => !i.isNewSession)).toBe(true);
    });

    it('should parse new session markers', async () => {
      // Given
      const content = 'prompt1\n>>> new session\nprompt3';
      vi.mocked(fs.readFile).mockResolvedValue(content);

      // When
      await queueManager.reload();

      // Then
      const items = queueManager.getItems();
      expect(items[1].isNewSession).toBe(true);
      expect(items[1].prompt).toBe('new session');
    });

    it('should skip empty lines', async () => {
      // Given
      const content = 'prompt1\n\n\nprompt2';
      vi.mocked(fs.readFile).mockResolvedValue(content);

      // When
      await queueManager.reload();

      // Then
      expect(queueManager.getItems()).toHaveLength(2);
    });

    it('should trim whitespace from lines', async () => {
      // Given
      const content = '  prompt1  \n  prompt2  ';
      vi.mocked(fs.readFile).mockResolvedValue(content);

      // When
      await queueManager.reload();

      // Then
      const items = queueManager.getItems();
      expect(items[0].prompt).toBe('prompt1');
      expect(items[1].prompt).toBe('prompt2');
    });
  });

  describe('serializeQueue (via file write)', () => {
    it('should serialize regular prompts', async () => {
      // Given - mock readFile to return previously saved content
      vi.mocked(fs.readFile)
        .mockRejectedValueOnce({ code: 'ENOENT' }) // First addItem: no file
        .mockResolvedValueOnce('prompt1'); // Second addItem: has prompt1
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('prompt1');
      await queueManager.addItem('prompt2');

      // Then - verify writeFile was called with correct serialized content
      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        'prompt1\nprompt2',
        expect.any(Object)
      );
    });

    it('should serialize new session markers with >>> prefix', async () => {
      // Given - mock readFile to return previously saved content
      vi.mocked(fs.readFile)
        .mockRejectedValueOnce({ code: 'ENOENT' }) // First addItem: no file
        .mockResolvedValueOnce('prompt1'); // Second addItem: has prompt1
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('prompt1');
      await queueManager.addItem('new session', true);

      // Then
      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        'prompt1\n>>> new session',
        expect.any(Object)
      );
    });

    it('should write file with mode 0o600', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // When
      await queueManager.addItem('prompt1');

      // Then
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { mode: 0o600 }
      );
    });
  });

  describe('events', () => {
    it('should emit item_added event when item is added', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      const eventHandler = vi.fn();
      queueManager.on('item_added', eventHandler);

      // When
      await queueManager.addItem('test prompt');

      // Then
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'item_added',
          queueLength: 1,
          timestamp: expect.any(Date),
        })
      );
    });

    it('should emit item_removed event when item is removed', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.reload();
      const eventHandler = vi.fn();
      queueManager.on('item_removed', eventHandler);

      // When
      await queueManager.removeLastItem();

      // Then
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'item_removed',
          queueLength: 0,
          timestamp: expect.any(Date),
        })
      );
    });

    it('should emit item_executed event when item is popped', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.reload();
      const eventHandler = vi.fn();
      queueManager.on('item_executed', eventHandler);

      // When
      await queueManager.popNextItem();

      // Then
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'item_executed',
          queueLength: 1,
          timestamp: expect.any(Date),
        })
      );
    });

    it('should emit queue_reloaded event when queue is reloaded', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      const eventHandler = vi.fn();
      queueManager.on('queue_reloaded', eventHandler);

      // When
      await queueManager.reload();

      // Then
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'queue_reloaded',
          queueLength: 2,
          timestamp: expect.any(Date),
        })
      );
    });

    it('should include item in event payload when available', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      const eventHandler = vi.fn();
      queueManager.on('item_added', eventHandler);

      // When
      await queueManager.addItem('test prompt', true);

      // Then
      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          item: expect.objectContaining({
            prompt: 'test prompt',
            isNewSession: true,
          }),
        })
      );
    });
  });

  describe('error handling', () => {
    it('should emit file_read_error event on persistent file read failure', async () => {
      // Given - use real timers for this test
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      const errorHandler = vi.fn();
      queueManager.on('file_read_error', errorHandler);

      // When
      await queueManager.reload();

      // Then - should emit event instead of throwing
      expect(errorHandler).toHaveBeenCalledTimes(1);
    }, 10000);

    it('should emit file_write_error event on persistent file write failure', async () => {
      // Given - use real timers for this test
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Disk full'));
      const errorHandler = vi.fn();
      queueManager.on('file_write_error', errorHandler);

      // When
      await queueManager.addItem('test');

      // Then - should emit event instead of throwing
      expect(errorHandler).toHaveBeenCalledTimes(1);
    }, 10000);

    it('should retry file read 2 times with 100ms delay', async () => {
      // Given - use real timers for retry tests
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Temporary failure'));

      // When
      await queueManager.reload();

      // Then
      expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(3); // Initial + 2 retries
    }, 10000); // Increase timeout for retry delays

    it('should retry file write 2 times with 100ms delay', async () => {
      // Given - use real timers for retry tests
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Temporary failure'));

      // When
      await queueManager.addItem('test');

      // Then
      // 1 call from ENOENT empty file creation (silently ignored) + 3 calls from saveToFile (initial + 2 retries)
      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledTimes(4);
    }, 10000); // Increase timeout for retry delays

    it('should initialize empty queue when file does not exist (ENOENT)', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      // When
      await queueManager.reload();

      // Then
      expect(queueManager.getItems()).toHaveLength(0);
    });

    it('should emit file_recovered event when file becomes accessible again', async () => {
      // Given - use real timers
      vi.useRealTimers();
      const recoveredHandler = vi.fn();
      queueManager.on('file_recovered', recoveredHandler);

      // First call fails (sets error state)
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      await queueManager.reload();

      // Then file becomes accessible
      vi.mocked(fs.readFile).mockResolvedValue('prompt1');

      // When
      await queueManager.reload();

      // Then
      expect(recoveredHandler).toHaveBeenCalledTimes(1);
    }, 10000);

    it('should only emit file_read_error once for consecutive failures', async () => {
      // Given - use real timers
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      const errorHandler = vi.fn();
      queueManager.on('file_read_error', errorHandler);

      // When - multiple reload attempts
      await queueManager.reload();
      await queueManager.reload();
      await queueManager.reload();

      // Then - should only emit once
      expect(errorHandler).toHaveBeenCalledTimes(1);
    }, 10000);

    it('should continue with in-memory queue on file read failure', async () => {
      // Given - use real timers
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      // When - reload fails but addItem should still work
      await queueManager.reload();
      await queueManager.addItem('test prompt');

      // Then - item should be in memory
      expect(queueManager.getItems()).toHaveLength(1);
      expect(queueManager.getItems()[0].prompt).toBe('test prompt');
    }, 10000);
  });

  describe('getLength', () => {
    it('should return correct queue length', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2\nprompt3');
      await queueManager.reload();

      // Then
      expect(queueManager.getLength()).toBe(3);
    });

    it('should return 0 for empty queue', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      await queueManager.reload();

      // Then
      expect(queueManager.getLength()).toBe(0);
    });
  });

  describe('reload', () => {
    it('should return fileFound: true and correct itemCount when file exists', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2\nprompt3');

      // When
      const result = await queueManager.reload();

      // Then
      expect(result.fileFound).toBe(true);
      expect(result.itemCount).toBe(3);
      expect(result.skippedLines).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should return fileFound: false when file does not exist', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      // When
      const result = await queueManager.reload();

      // Then
      expect(result.fileFound).toBe(false);
      expect(result.itemCount).toBe(0);
      expect(result.skippedLines).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should count skipped invalid lines (empty and whitespace-only)', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\n\nprompt2\n  \nprompt3');

      // When
      const result = await queueManager.reload();

      // Then
      expect(result.itemCount).toBe(3);
      expect(result.skippedLines).toBe(2); // 1 empty line + 1 whitespace-only line
    });

    it('should emit queue_reloaded event after reload', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1');
      const eventSpy = vi.fn();
      queueManager.on('queue_reloaded', eventSpy);

      // When
      await queueManager.reload();

      // Then
      expect(eventSpy).toHaveBeenCalledTimes(1);
      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'queue_reloaded',
          queueLength: 1,
        })
      );
    });
  });

  describe('getItems immutability', () => {
    it('should return a new array instance (not internal reference)', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      await queueManager.reload();

      // When
      const items1 = queueManager.getItems();
      const items2 = queueManager.getItems();

      // Then
      expect(items1).not.toBe(items2);
      expect(items1).toEqual(items2);
    });

    it('should not affect internal queue when returned array is modified', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      await queueManager.reload();
      const items = queueManager.getItems();

      // When - modify the returned array
      items.push({ prompt: 'injected', isNewSession: false });
      items[0].prompt = 'modified';

      // Then - internal queue should be unchanged in length
      expect(queueManager.getLength()).toBe(2);
      const freshItems = queueManager.getItems();
      expect(freshItems).toHaveLength(2);
      // Note: shallow copy means internal objects are still references
      // This documents the current behavior
    });
  });
});
