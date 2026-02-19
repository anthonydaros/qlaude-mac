import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BatchReporter } from '../../src/utils/batch-report.js';

// Mock fs and logger
vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// Use fixed directory for config mock
vi.mock('../../src/utils/config.js', () => ({
  QLAUDE_DIR: '.qlaude',
}));

import { writeFileSync } from 'fs';

describe('BatchReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should store queueFile when provided', () => {
      const reporter = new BatchReporter('tasks.txt');
      reporter.start();
      reporter.writeReport('completed');

      const call = vi.mocked(writeFileSync).mock.calls[0];
      const report = JSON.parse(call[1] as string);
      expect(report.queueFile).toBe('tasks.txt');
    });

    it('should set queueFile to null when not provided', () => {
      const reporter = new BatchReporter();
      reporter.start();
      reporter.writeReport('completed');

      const call = vi.mocked(writeFileSync).mock.calls[0];
      const report = JSON.parse(call[1] as string);
      expect(report.queueFile).toBeNull();
    });
  });

  describe('start', () => {
    it('should reset counters on start', () => {
      const reporter = new BatchReporter();

      // Record some items before calling start
      reporter.start();
      reporter.recordItemExecuted();

      // Start again should reset
      reporter.start();
      reporter.writeReport('completed');

      const call = vi.mocked(writeFileSync).mock.calls[0];
      const report = JSON.parse(call[1] as string);
      expect(report.itemsExecuted).toBe(0);
    });
  });

  describe('recordItemExecuted', () => {
    it('should increment items counter', () => {
      const reporter = new BatchReporter();
      reporter.start();
      reporter.recordItemExecuted();
      reporter.recordItemExecuted();
      reporter.recordItemExecuted();
      reporter.writeReport('completed');

      const call = vi.mocked(writeFileSync).mock.calls[0];
      const report = JSON.parse(call[1] as string);
      expect(report.itemsExecuted).toBe(3);
    });
  });

  describe('writeReport', () => {
    it('should write completed report with correct fields', () => {
      const reporter = new BatchReporter('queue.txt');
      reporter.start();
      reporter.recordItemExecuted();
      reporter.recordItemExecuted();
      reporter.writeReport('completed');

      expect(writeFileSync).toHaveBeenCalledTimes(1);
      const call = vi.mocked(writeFileSync).mock.calls[0];
      const reportPath = call[0] as string;
      const content = call[1] as string;

      expect(reportPath).toContain('batch-report.json');
      const report = JSON.parse(content);
      expect(report.status).toBe('completed');
      expect(report.itemsExecuted).toBe(2);
      expect(report.error).toBeNull();
      expect(report.queueFile).toBe('queue.txt');
      expect(report.startTime).toBeDefined();
      expect(report.endTime).toBeDefined();
      expect(report.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('should write failed report with error message', () => {
      const reporter = new BatchReporter();
      reporter.start();
      reporter.writeReport('failed', 'Task failed');

      const call = vi.mocked(writeFileSync).mock.calls[0];
      const report = JSON.parse(call[1] as string);
      expect(report.status).toBe('failed');
      expect(report.error).toBe('Task failed');
    });

    it('should handle missing start time gracefully', () => {
      const reporter = new BatchReporter();
      // Don't call start() — startTime is null
      reporter.writeReport('completed');

      const call = vi.mocked(writeFileSync).mock.calls[0];
      const report = JSON.parse(call[1] as string);
      expect(report.startTime).toBeDefined();
      expect(report.durationMs).toBe(0);
    });

    it('should return the report file path', () => {
      const reporter = new BatchReporter();
      reporter.start();
      const path = reporter.writeReport('completed');
      expect(path).toContain('batch-report.json');
    });

    it('should handle write errors gracefully', () => {
      vi.mocked(writeFileSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const reporter = new BatchReporter();
      reporter.start();
      // Should not throw
      const path = reporter.writeReport('failed', 'some error');
      expect(path).toContain('batch-report.json');
    });
  });
});
