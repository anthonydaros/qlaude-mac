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
      const manager = new QueueManager();
      expect(manager['filePath']).toBe('.qlaude/queue');
    });

    it('should accept custom file path', () => {
      const manager = new QueueManager('/custom/path/.queue');
      expect(manager['filePath']).toBe('/custom/path/.queue');
    });
  });

  describe('addItem', () => {
    it('should add regular prompt to queue', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await queueManager.addItem('test prompt');

      const items = queueManager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].prompt).toBe('test prompt');
      expect(items[0].isNewSession).toBe(false);
    });

    it('should add new session marker to queue', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await queueManager.addItem('new session prompt', true);

      const items = queueManager.getItems();
      expect(items[0].isNewSession).toBe(true);
    });

    it('should set addedAt date when adding item', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      const now = new Date('2026-01-28T12:00:00Z');
      vi.setSystemTime(now);

      await queueManager.addItem('test prompt');

      const items = queueManager.getItems();
      expect(items[0].addedAt).toEqual(now);
    });

    it('should serialize concurrent addItem calls without losing data', async () => {
      vi.useRealTimers();
      let fileContent = '';
      let writeCount = 0;

      vi.mocked(fs.readFile).mockImplementation(async () => fileContent);
      vi.mocked(fs.writeFile).mockImplementation(async (_path, content) => {
        writeCount++;
        if (writeCount === 1) {
          await new Promise(resolve => setTimeout(resolve, 30));
        }
        fileContent = String(content);
      });

      await Promise.all([
        queueManager.addItem('first'),
        queueManager.addItem('second'),
      ]);

      expect(fileContent).toBe('first\nsecond');
      expect(queueManager.getItems().map(i => i.prompt)).toEqual(['first', 'second']);
    });
  });

  describe('removeLastItem', () => {
    it('should remove and return last item', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.reload();

      const removed = await queueManager.removeLastItem();

      expect(removed?.prompt).toBe('prompt2');
      expect(queueManager.getLength()).toBe(1);
    });

    it('should return null when queue is empty', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      const removed = await queueManager.removeLastItem();

      expect(removed).toBeNull();
    });
  });

  describe('getNextItem', () => {
    it('should return first item without removing it', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      await queueManager.reload();

      const item = queueManager.getNextItem();

      expect(item?.prompt).toBe('prompt1');
      expect(queueManager.getLength()).toBe(2);
    });

    it('should return null when queue is empty', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      await queueManager.reload();

      expect(queueManager.getNextItem()).toBeNull();
    });
  });

  describe('popNextItem', () => {
    it('should remove and return first item', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.reload();

      const item = await queueManager.popNextItem();

      expect(item?.prompt).toBe('prompt1');
      expect(queueManager.getLength()).toBe(1);
      expect(queueManager.getNextItem()?.prompt).toBe('prompt2');
    });

    it('should return null when queue is empty', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      expect(await queueManager.popNextItem()).toBeNull();
    });
  });

  describe('parseQueueFile - @ directives (via reload)', () => {
    it('should parse bare text as regular prompts', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2\nprompt3');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items).toHaveLength(3);
      expect(items.every((i) => !i.isNewSession)).toBe(true);
    });

    it('should parse @new as new session marker (standalone)', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\n@new\nprompt2');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items).toHaveLength(3);
      expect(items[1].isNewSession).toBe(true);
      expect(items[1].prompt).toBe('');
    });

    it('should parse @pause as breakpoint', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\n@pause check here\nprompt2');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items[1].isBreakpoint).toBe(true);
      expect(items[1].prompt).toBe('check here');
    });

    it('should parse @pause without reason', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('@pause');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items[0].isBreakpoint).toBe(true);
      expect(items[0].prompt).toBe('');
    });

    it('should parse @save as label session', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('@save checkpoint-v1');

      await queueManager.reload();

      expect(queueManager.getItems()[0].labelSession).toBe('checkpoint-v1');
    });

    it('should parse @load as load session (standalone)', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('@load checkpoint-v1');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items[0].isNewSession).toBe(true);
      expect(items[0].loadSessionLabel).toBe('checkpoint-v1');
      expect(items[0].prompt).toBe('');
    });

    it('should parse \\@ as escaped @ prompt', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('\\@username mentioned this');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items[0].prompt).toBe('@username mentioned this');
      expect(items[0].isNewSession).toBe(false);
    });

    it('should parse \\\\@ as escaped \\@ prompt', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('\\\\@escaped');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items[0].prompt).toBe('\\@escaped');
    });

    it('should parse multiline blocks with @( ... @)', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('@(\nline1\nline2\n@)');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].isMultiline).toBe(true);
      expect(items[0].prompt).toBe('line1\nline2');
      expect(items[0].isNewSession).toBe(false);
    });

    it('should NOT parse @new( as multiline block (removed)', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('@new(\nline1\nline2\n@)');

      await queueManager.reload();

      // @new( is treated as unknown directive (bare prompt), lines are separate items
      const items = queueManager.getItems();
      expect(items[0].prompt).toBe('@new(');
      expect(items[0].isMultiline).toBeFalsy();
    });

    it('should treat interactive-only @directives as bare prompts', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('@add something\n@drop');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items[0].prompt).toBe('@add something');
      expect(items[0].isNewSession).toBe(false);
      expect(items[1].prompt).toBe('@drop');
    });

    it('should treat unknown @directives as bare prompts', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('@unknown something');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items[0].prompt).toBe('@unknown something');
    });

    it('should skip empty lines and comments', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\n\n# comment\n\nprompt2');

      await queueManager.reload();

      expect(queueManager.getItems()).toHaveLength(2);
    });

    it('should trim whitespace from lines', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('  prompt1  \n  prompt2  ');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items[0].prompt).toBe('prompt1');
      expect(items[1].prompt).toBe('prompt2');
    });

    it('should handle unclosed multiline block', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('@(\nline1\nline2');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items).toHaveLength(1);
      expect(items[0].isMultiline).toBe(true);
      expect(items[0].prompt).toBe('line1\nline2');
    });

    it('should NOT parse : prefix in queue files (only @ directives)', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(':new something\n:bp check\n:save test');

      await queueManager.reload();

      const items = queueManager.getItems();
      expect(items).toHaveLength(3);
      expect(items[0].prompt).toBe(':new something');
      expect(items[0].isNewSession).toBe(false);
      expect(items[1].prompt).toBe(':bp check');
      expect(items[2].prompt).toBe(':save test');
    });
  });

  describe('serializeQueue - @ directives (via file write)', () => {
    it('should serialize regular prompts as bare text', async () => {
      vi.mocked(fs.readFile)
        .mockRejectedValueOnce({ code: 'ENOENT' })
        .mockResolvedValueOnce('prompt1');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('prompt1');
      await queueManager.addItem('prompt2');

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        'prompt1\nprompt2',
        expect.any(Object)
      );
    });

    it('should serialize new session markers with @new', async () => {
      vi.mocked(fs.readFile)
        .mockRejectedValueOnce({ code: 'ENOENT' })
        .mockResolvedValueOnce('prompt1');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('prompt1');
      await queueManager.addItem('', true);

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        'prompt1\n@new',
        expect.any(Object)
      );
    });

    it('should serialize breakpoints with @pause', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('check here', { isBreakpoint: true });

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        '@pause check here',
        expect.any(Object)
      );
    });

    it('should serialize save session with @save', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('', { labelSession: 'checkpoint-v1' });

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        '@save checkpoint-v1',
        expect.any(Object)
      );
    });

    it('should serialize load session with @load', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('', { isNewSession: true, loadSessionLabel: 'cp1' });

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        '@load cp1',
        expect.any(Object)
      );
    });

    it('should serialize model switch with @model', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('/model opus', { modelName: 'opus' });

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        '@model opus',
        expect.any(Object)
      );
    });

    it('should ignore empty modelName option', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('/model', { modelName: '' });

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        '/model',
        expect.any(Object)
      );
    });

    it('should serialize delay with @delay', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('', { delayMs: 5000 });

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        '@delay 5000',
        expect.any(Object)
      );
    });

    it('should ignore zero/negative delayMs option', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('test', { delayMs: 0 });

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        'test',
        expect.any(Object)
      );
    });

    it('should serialize multiline prompts with @( ... @)', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('line1\nline2', { isMultiline: true });

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        '@(\nline1\nline2\n@)',
        expect.any(Object)
      );
    });

    it('should serialize new session + multiline as @new then @( block', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('line1\nline2', { isNewSession: true, isMultiline: true });

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        '@new\n@(\nline1\nline2\n@)',
        expect.any(Object)
      );
    });

    it('should escape prompts starting with @', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('@username mentioned this');

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        '\\@username mentioned this',
        expect.any(Object)
      );
    });

    it('should escape prompts starting with \\@', async () => {
      vi.mocked(fs.readFile).mockRejectedValueOnce({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.addItem('\\@escaped');

      expect(vi.mocked(fs.writeFile)).toHaveBeenLastCalledWith(
        expect.any(String),
        '\\\\@escaped',
        expect.any(Object)
      );
    });

    it('should write file with mode 0o600', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await queueManager.addItem('prompt1');

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        { mode: 0o600 }
      );
    });
  });

  describe('events', () => {
    it('should emit item_added event when item is added', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      const eventHandler = vi.fn();
      queueManager.on('item_added', eventHandler);

      await queueManager.addItem('test prompt');

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'item_added',
          queueLength: 1,
          timestamp: expect.any(Date),
        })
      );
    });

    it('should emit item_removed event when item is removed', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.reload();
      const eventHandler = vi.fn();
      queueManager.on('item_removed', eventHandler);

      await queueManager.removeLastItem();

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'item_removed',
          queueLength: 0,
          timestamp: expect.any(Date),
        })
      );
    });

    it('should emit item_executed event when item is popped', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      await queueManager.reload();
      const eventHandler = vi.fn();
      queueManager.on('item_executed', eventHandler);

      await queueManager.popNextItem();

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'item_executed',
          queueLength: 1,
          timestamp: expect.any(Date),
        })
      );
    });

    it('should emit queue_reloaded event when queue is reloaded', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      const eventHandler = vi.fn();
      queueManager.on('queue_reloaded', eventHandler);

      await queueManager.reload();

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'queue_reloaded',
          queueLength: 2,
          timestamp: expect.any(Date),
        })
      );
    });

    it('should include item in event payload when available', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      const eventHandler = vi.fn();
      queueManager.on('item_added', eventHandler);

      await queueManager.addItem('test prompt', true);

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
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      const errorHandler = vi.fn();
      queueManager.on('file_read_error', errorHandler);

      await queueManager.reload();

      expect(errorHandler).toHaveBeenCalledTimes(1);
    }, 10000);

    it('should emit file_write_error event on persistent file write failure', async () => {
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Disk full'));
      const errorHandler = vi.fn();
      queueManager.on('file_write_error', errorHandler);

      await queueManager.addItem('test');

      expect(errorHandler).toHaveBeenCalledTimes(1);
    }, 10000);

    it('should retry file read 2 times with 100ms delay', async () => {
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Temporary failure'));

      await queueManager.reload();

      expect(vi.mocked(fs.readFile)).toHaveBeenCalledTimes(3);
    }, 10000);

    it('should retry file write 2 times with 100ms delay', async () => {
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      vi.mocked(fs.writeFile).mockRejectedValue(new Error('Temporary failure'));

      await queueManager.addItem('test');

      expect(vi.mocked(fs.writeFile)).toHaveBeenCalledTimes(4);
    }, 10000);

    it('should initialize empty queue when file does not exist (ENOENT)', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      await queueManager.reload();

      expect(queueManager.getItems()).toHaveLength(0);
    });

    it('should emit file_recovered event when file becomes accessible again', async () => {
      vi.useRealTimers();
      const recoveredHandler = vi.fn();
      queueManager.on('file_recovered', recoveredHandler);

      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      await queueManager.reload();

      vi.mocked(fs.readFile).mockResolvedValue('prompt1');

      await queueManager.reload();

      expect(recoveredHandler).toHaveBeenCalledTimes(1);
    }, 10000);

    it('should only emit file_read_error once for consecutive failures', async () => {
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      const errorHandler = vi.fn();
      queueManager.on('file_read_error', errorHandler);

      await queueManager.reload();
      await queueManager.reload();
      await queueManager.reload();

      expect(errorHandler).toHaveBeenCalledTimes(1);
    }, 10000);

    it('should continue with in-memory queue on file read failure', async () => {
      vi.useRealTimers();
      vi.mocked(fs.readFile).mockRejectedValue(new Error('Permission denied'));
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      await queueManager.reload();
      await queueManager.addItem('test prompt');

      expect(queueManager.getItems()).toHaveLength(1);
      expect(queueManager.getItems()[0].prompt).toBe('test prompt');
    }, 10000);
  });

  describe('getLength', () => {
    it('should return correct queue length', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2\nprompt3');
      await queueManager.reload();

      expect(queueManager.getLength()).toBe(3);
    });

    it('should return 0 for empty queue', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });
      await queueManager.reload();

      expect(queueManager.getLength()).toBe(0);
    });
  });

  describe('reload', () => {
    it('should return fileFound: true and correct itemCount when file exists', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2\nprompt3');

      const result = await queueManager.reload();

      expect(result.fileFound).toBe(true);
      expect(result.itemCount).toBe(3);
      expect(result.skippedLines).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should return fileFound: false when file does not exist', async () => {
      vi.mocked(fs.readFile).mockRejectedValue({ code: 'ENOENT' });

      const result = await queueManager.reload();

      expect(result.fileFound).toBe(false);
      expect(result.itemCount).toBe(0);
      expect(result.skippedLines).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should count skipped invalid lines (empty and whitespace-only)', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\n\nprompt2\n  \nprompt3');

      const result = await queueManager.reload();

      expect(result.itemCount).toBe(3);
      expect(result.skippedLines).toBe(2);
    });

    it('should emit queue_reloaded event after reload', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1');
      const eventSpy = vi.fn();
      queueManager.on('queue_reloaded', eventSpy);

      await queueManager.reload();

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
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      await queueManager.reload();

      const items1 = queueManager.getItems();
      const items2 = queueManager.getItems();

      expect(items1).not.toBe(items2);
      expect(items1).toEqual(items2);
    });

    it('should not affect internal queue when returned array is modified', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('prompt1\nprompt2');
      await queueManager.reload();
      const items = queueManager.getItems();

      items.push({ prompt: 'injected', isNewSession: false });
      items[0].prompt = 'modified';

      expect(queueManager.getLength()).toBe(2);
      expect(queueManager.getItems()).toHaveLength(2);
    });
  });
});
