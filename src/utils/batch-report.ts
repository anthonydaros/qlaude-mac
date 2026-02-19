/**
 * BatchReporter generates execution summary reports for batch mode (---run).
 * Writes a JSON report to .qlaude/batch-report.json on queue completion or failure.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { QLAUDE_DIR } from './config.js';
import { logger } from './logger.js';

export interface BatchReportData {
  status: 'completed' | 'failed';
  startTime: string;
  endTime: string;
  durationMs: number;
  itemsExecuted: number;
  error: string | null;
  queueFile: string | null;
}

const REPORT_FILENAME = 'batch-report.json';

export class BatchReporter {
  private startTime: Date | null = null;
  private itemsExecuted = 0;
  private queueFile: string | null;

  constructor(queueFile?: string) {
    this.queueFile = queueFile ?? null;
  }

  start(): void {
    this.startTime = new Date();
    this.itemsExecuted = 0;
  }

  recordItemExecuted(): void {
    this.itemsExecuted++;
  }

  writeReport(status: 'completed' | 'failed', error?: string): string {
    const endTime = new Date();
    const startTime = this.startTime ?? endTime;

    const report: BatchReportData = {
      status,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs: endTime.getTime() - startTime.getTime(),
      itemsExecuted: this.itemsExecuted,
      error: error ?? null,
      queueFile: this.queueFile,
    };

    const reportPath = join(process.cwd(), QLAUDE_DIR, REPORT_FILENAME);
    try {
      writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf-8');
      logger.info({ reportPath, status }, 'Batch report written');
    } catch (err) {
      logger.error({ err, reportPath }, 'Failed to write batch report');
    }

    return reportPath;
  }
}
