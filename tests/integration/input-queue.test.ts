import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { parse, isQueueCommand } from '../../src/input-parser.js';
import { QueueManager } from '../../src/queue-manager.js';

// Mock fs module for file operations
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

describe('InputParser + QueueManager Integration', () => {
  const TEST_QUEUE_FILE = '.test-queue';
  let queueManager: QueueManager;

  beforeEach(() => {
    vi.clearAllMocks();
    queueManager = new QueueManager(TEST_QUEUE_FILE);

    // Default mock: empty queue file (ENOENT)
    vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
    vi.mocked(fs.writeFile).mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('>> command flow', () => {
    it('should add item to queue when >> command is parsed and executed', async () => {
      // Given
      const input = '>> test prompt for queue';
      const parseResult = parse(input);

      // When
      expect(parseResult.type).toBe('QUEUE_ADD');
      expect(parseResult.prompt).toBe('test prompt for queue');

      if (parseResult.prompt) {
        await queueManager.addItem(parseResult.prompt);
      }

      // Then
      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        'test prompt for queue',
        expect.any(Object)
      );
    });

    it('should not call queueManager when prompt is empty', async () => {
      // Given
      const input = '>> ';
      const parseResult = parse(input);

      // When
      expect(parseResult.type).toBe('QUEUE_ADD');
      expect(parseResult.prompt).toBeUndefined();

      // Then - no addItem call should happen
      if (parseResult.prompt) {
        await queueManager.addItem(parseResult.prompt);
      }

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle special characters in prompt', async () => {
      // Given
      const input = '>> prompt with $pecial ch@rs & symbols!';
      const parseResult = parse(input);

      // When
      if (parseResult.prompt) {
        await queueManager.addItem(parseResult.prompt);
      }

      // Then
      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        'prompt with $pecial ch@rs & symbols!',
        expect.any(Object)
      );
    });
  });

  describe('PASSTHROUGH command flow', () => {
    it('should return PASSTHROUGH for regular input (no queue operation)', () => {
      // Given
      const input = 'regular command to Claude';

      // When
      const parseResult = parse(input);

      // Then
      expect(parseResult.type).toBe('PASSTHROUGH');
      expect(parseResult.prompt).toBeUndefined();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should return PASSTHROUGH for >> without space', () => {
      // Given
      const input = '>>noSpace';

      // When
      const parseResult = parse(input);

      // Then
      expect(parseResult.type).toBe('PASSTHROUGH');
      expect(isQueueCommand(input)).toBe(false);
    });
  });

  describe('isQueueCommand helper', () => {
    it('should correctly identify queue commands before parsing', () => {
      // These should be identified as queue commands
      expect(isQueueCommand('>> test')).toBe(true);
      expect(isQueueCommand('>> ')).toBe(true);

      // These should not be identified as queue commands
      expect(isQueueCommand('>>')).toBe(false);
      expect(isQueueCommand('>>test')).toBe(false);
      expect(isQueueCommand('regular text')).toBe(false);
      expect(isQueueCommand('> single arrow')).toBe(false);
    });
  });

  describe('Queue file persistence', () => {
    it('should append to existing queue items', async () => {
      // Given - existing queue with one item
      vi.mocked(fs.readFile).mockResolvedValue('existing prompt');

      const input = '>> new prompt';
      const parseResult = parse(input);

      // When
      if (parseResult.prompt) {
        await queueManager.addItem(parseResult.prompt);
      }

      // Then
      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        'existing prompt\nnew prompt',
        expect.any(Object)
      );
    });
  });

  // QUEUE_NEW_SESSION tests (Story 2.4)
  describe('>>> command flow', () => {
    it('should add item with isNewSession: true when >>> command is parsed', async () => {
      // Given
      const input = '>>> new session prompt';
      const parseResult = parse(input);

      // When
      expect(parseResult.type).toBe('QUEUE_NEW_SESSION');
      if (parseResult.prompt) {
        await queueManager.addItem(parseResult.prompt, true);
      }

      // Then
      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        '>>> new session prompt',
        expect.any(Object)
      );
    });

    it('should serialize new session items with >>> prefix in queue file', async () => {
      // Given - existing queue with regular item
      vi.mocked(fs.readFile).mockResolvedValue('existing prompt');

      // When
      await queueManager.addItem('new session prompt', true);

      // Then
      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        'existing prompt\n>>> new session prompt',
        expect.any(Object)
      );
    });
  });

  // QUEUE_REMOVE tests (Story 2.3)
  describe('<< command flow', () => {
    it('should remove last item when << command is parsed', async () => {
      // Given - queue with two items
      vi.mocked(fs.readFile).mockResolvedValue('first prompt\nsecond prompt');

      const input = '<<';
      const parseResult = parse(input);

      // When
      expect(parseResult.type).toBe('QUEUE_REMOVE');
      const removed = await queueManager.removeLastItem();

      // Then
      expect(removed?.prompt).toBe('second prompt');
      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        'first prompt',
        expect.any(Object)
      );
    });

    it('should return null when removing from empty queue', async () => {
      // Given - empty queue (ENOENT)
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      const input = '<<';
      const parseResult = parse(input);

      // When
      expect(parseResult.type).toBe('QUEUE_REMOVE');
      const removed = await queueManager.removeLastItem();

      // Then
      expect(removed).toBeNull();
    });

    it('should parse << with trailing text as QUEUE_REMOVE', () => {
      // Given
      const input = '<<abc';

      // When
      const parseResult = parse(input);

      // Then
      expect(parseResult.type).toBe('QUEUE_REMOVE');
      expect(isQueueCommand(input)).toBe(true);
    });
  });

  // META_RELOAD tests (colon commands)
  describe(':reload command flow', () => {
    it('should reload queue when :reload command is parsed', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      const input = ':reload';
      const parseResult = parse(input);

      // When
      expect(parseResult.type).toBe('META_RELOAD');
      const reloadResult = await queueManager.reload();

      // Then
      expect(reloadResult.fileFound).toBe(true);
      expect(reloadResult.itemCount).toBe(2);
      expect(queueManager.getItems()).toHaveLength(2);
    });

    it('should handle file not found when :reload command is parsed', async () => {
      // Given
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      const input = ':reload';
      const parseResult = parse(input);

      // When
      expect(parseResult.type).toBe('META_RELOAD');
      const reloadResult = await queueManager.reload();

      // Then
      expect(reloadResult.fileFound).toBe(false);
      expect(reloadResult.itemCount).toBe(0);
    });

    it('should report skipped invalid lines when file has empty lines', async () => {
      // Given
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\n\n\nprompt2');
      const input = ':reload';
      const parseResult = parse(input);

      // When
      expect(parseResult.type).toBe('META_RELOAD');
      const reloadResult = await queueManager.reload();

      // Then
      expect(reloadResult.itemCount).toBe(2);
      expect(reloadResult.skippedLines).toBe(2); // 2 empty lines
    });
  });
});
