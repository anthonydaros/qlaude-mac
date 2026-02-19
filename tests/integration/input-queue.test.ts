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

  describe(':add command flow', () => {
    it('should add item to queue when :add command is parsed and executed', async () => {
      const input = ':add test prompt for queue';
      const parseResult = parse(input);

      expect(parseResult.type).toBe('QUEUE_ADD');
      expect(parseResult.prompt).toBe('test prompt for queue');

      if (parseResult.prompt) {
        await queueManager.addItem(parseResult.prompt);
      }

      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        'test prompt for queue',
        expect.any(Object)
      );
    });

    it('should not call queueManager when :add has no prompt', async () => {
      const input = ':add';
      const parseResult = parse(input);

      expect(parseResult.type).toBe('QUEUE_ADD');
      expect(parseResult.prompt).toBeUndefined();

      if (parseResult.prompt) {
        await queueManager.addItem(parseResult.prompt);
      }

      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should handle special characters in :add prompt', async () => {
      const input = ':add prompt with $pecial ch@rs & symbols!';
      const parseResult = parse(input);

      if (parseResult.prompt) {
        await queueManager.addItem(parseResult.prompt);
      }

      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        'prompt with $pecial ch@rs & symbols!',
        expect.any(Object)
      );
    });

    it('should escape @ at start of prompt when saving to queue file', async () => {
      const input = ':add @username mentioned this';
      const parseResult = parse(input);

      if (parseResult.prompt) {
        await queueManager.addItem(parseResult.prompt);
      }

      // @ prompts should be escaped with \@ in queue file
      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        '\\@username mentioned this',
        expect.any(Object)
      );
    });
  });

  describe(':add @new command flow', () => {
    it('should parse :add @new as QUEUE_ADD with @new prompt', () => {
      const parseResult = parse(':add @new');

      expect(parseResult.type).toBe('QUEUE_ADD');
      expect(parseResult.prompt).toBe('@new');
    });

    it('should add new session marker to queue (via main.ts @new handling)', async () => {
      // main.ts detects prompt starting with @new and calls addItem with isNewSession
      await queueManager.addItem('', { isNewSession: true });

      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        '@new',
        expect.any(Object)
      );
    });

    it('should serialize @new in queue file when appended', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('existing prompt');

      await queueManager.addItem('', { isNewSession: true });

      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        'existing prompt\n@new',
        expect.any(Object)
      );
    });
  });

  describe(':add @pause command flow', () => {
    it('should parse :add @pause as QUEUE_ADD', () => {
      const parseResult = parse(':add @pause check here');

      expect(parseResult.type).toBe('QUEUE_ADD');
      expect(parseResult.prompt).toBe('@pause check here');
    });

    it('should add pause marker to queue (via main.ts @pause handling)', async () => {
      await queueManager.addItem('check here', { isBreakpoint: true });

      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        '@pause check here',
        expect.any(Object)
      );
    });
  });

  describe(':add @save/@load command flow', () => {
    it('should parse :add @save as QUEUE_ADD', () => {
      const parseResult = parse(':add @save checkpoint');

      expect(parseResult.type).toBe('QUEUE_ADD');
      expect(parseResult.prompt).toBe('@save checkpoint');
    });

    it('should add save marker to queue', async () => {
      await queueManager.addItem('', { labelSession: 'checkpoint' });

      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        '@save checkpoint',
        expect.any(Object)
      );
    });

    it('should add load marker to queue', async () => {
      await queueManager.addItem('', { isNewSession: true, loadSessionLabel: 'checkpoint' });

      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        '@load checkpoint',
        expect.any(Object)
      );
    });
  });

  describe(':drop command flow', () => {
    it('should remove last item when :drop command is parsed', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('first prompt\nsecond prompt');

      const parseResult = parse(':drop');

      expect(parseResult.type).toBe('QUEUE_REMOVE');
      const removed = await queueManager.removeLastItem();

      expect(removed?.prompt).toBe('second prompt');
      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        'first prompt',
        expect.any(Object)
      );
    });

    it('should return null when removing from empty queue', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      const parseResult = parse(':drop');

      expect(parseResult.type).toBe('QUEUE_REMOVE');
      const removed = await queueManager.removeLastItem();

      expect(removed).toBeNull();
    });
  });

  describe('PASSTHROUGH flow', () => {
    it('should return PASSTHROUGH for regular input (no queue operation)', () => {
      const input = 'regular command to Claude';
      const parseResult = parse(input);

      expect(parseResult.type).toBe('PASSTHROUGH');
      expect(parseResult.prompt).toBeUndefined();
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('should return PASSTHROUGH for > (shortcuts removed)', () => {
      expect(parse('> test prompt').type).toBe('PASSTHROUGH');
      expect(isQueueCommand('> test')).toBe(false);
    });

    it('should return PASSTHROUGH for >> (shortcuts removed)', () => {
      expect(parse('>>').type).toBe('PASSTHROUGH');
      expect(isQueueCommand('>>')).toBe(false);
    });

    it('should return PASSTHROUGH for < (shortcuts removed)', () => {
      expect(parse('<').type).toBe('PASSTHROUGH');
      expect(isQueueCommand('<')).toBe(false);
    });

    it('should return PASSTHROUGH for :bp (removed)', () => {
      expect(parse(':bp').type).toBe('PASSTHROUGH');
      expect(isQueueCommand(':bp')).toBe(false);
    });
  });

  describe('isQueueCommand helper', () => {
    it('should correctly identify : commands', () => {
      // Known :commands
      expect(isQueueCommand(':add test')).toBe(true);
      expect(isQueueCommand(':drop')).toBe(true);
      expect(isQueueCommand(':clear')).toBe(true);
      expect(isQueueCommand(':save name')).toBe(true);
      expect(isQueueCommand(':load name')).toBe(true);
      expect(isQueueCommand(':pause')).toBe(true);
      expect(isQueueCommand(':resume')).toBe(true);
      expect(isQueueCommand(':reload')).toBe(true);
      expect(isQueueCommand(':status')).toBe(true);
      expect(isQueueCommand(':help')).toBe(true);
      expect(isQueueCommand(':list')).toBe(true);
    });

    it('should return false for non-commands', () => {
      expect(isQueueCommand('regular text')).toBe(false);
      expect(isQueueCommand(':unknown')).toBe(false);
      expect(isQueueCommand('> test')).toBe(false);
      expect(isQueueCommand('>>')).toBe(false);
      expect(isQueueCommand('<')).toBe(false);
      expect(isQueueCommand(':bp')).toBe(false);
      expect(isQueueCommand(':new')).toBe(false);
      expect(isQueueCommand(':del')).toBe(false);
      expect(isQueueCommand('')).toBe(false);
    });
  });

  describe('Queue file persistence', () => {
    it('should append to existing queue items', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('existing prompt');

      const input = ':add new prompt';
      const parseResult = parse(input);

      if (parseResult.prompt) {
        await queueManager.addItem(parseResult.prompt);
      }

      expect(fs.writeFile).toHaveBeenCalledWith(
        TEST_QUEUE_FILE,
        'existing prompt\nnew prompt',
        expect.any(Object)
      );
    });
  });

  describe(':reload command flow', () => {
    it('should reload queue when :reload command is parsed', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      const parseResult = parse(':reload');

      expect(parseResult.type).toBe('META_RELOAD');
      const reloadResult = await queueManager.reload();

      expect(reloadResult.fileFound).toBe(true);
      expect(reloadResult.itemCount).toBe(2);
      expect(queueManager.getItems()).toHaveLength(2);
    });

    it('should handle file not found when :reload command is parsed', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      const parseResult = parse(':reload');

      expect(parseResult.type).toBe('META_RELOAD');
      const reloadResult = await queueManager.reload();

      expect(reloadResult.fileFound).toBe(false);
      expect(reloadResult.itemCount).toBe(0);
    });

    it('should report skipped lines (empty/comments) when reloading', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\n\n# comment\nprompt2');
      const reloadResult = await queueManager.reload();

      expect(reloadResult.itemCount).toBe(2);
      expect(reloadResult.skippedLines).toBe(2); // 1 empty + 1 comment
    });
  });

  describe('Queue file with @ directives', () => {
    it('should parse @new from queue file correctly', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\n@new\nprompt2');
      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items).toHaveLength(3);
      expect(items[0].prompt).toBe('prompt1');
      expect(items[0].isNewSession).toBe(false);
      expect(items[1].prompt).toBe('');
      expect(items[1].isNewSession).toBe(true);
      expect(items[2].prompt).toBe('prompt2');
    });

    it('should parse @pause from queue file correctly', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\n@pause check results');
      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items).toHaveLength(2);
      expect(items[1].isBreakpoint).toBe(true);
      expect(items[1].prompt).toBe('check results');
    });

    it('should parse \\@ escape from queue file correctly', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('\\@username mentioned this');
      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].prompt).toBe('@username mentioned this');
    });
  });
});
