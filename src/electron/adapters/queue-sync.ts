import { writeFileSync } from 'fs';
import { join } from 'path';
import { mkdirSync } from 'fs';
import type { QueueManager } from '../../queue-manager.js';
import type { TaskRepository, Task } from '../db/task-repository.js';

/**
 * Serializes a Task into a .qlaude/queue line format
 */
function taskToQueueLine(task: Task): string | null {
  if (task.is_new_session) return '@new';
  if (task.is_breakpoint) return task.prompt ? `@pause ${task.prompt}` : '@pause';
  if (task.label_session) return `@save ${task.label_session}`;
  if (task.load_session_label) return `@load ${task.load_session_label}`;
  if (task.model_name) return `@model ${task.model_name}`;
  if (task.delay_ms) return `@delay ${task.delay_ms}`;
  if (task.prompt) {
    // Multiline prompts need @( ... @) wrapping
    if (task.prompt.includes('\n')) {
      return `@(\n${task.prompt}\n@)`;
    }
    return task.prompt;
  }
  return null;
}

export class QueueSyncAdapter {
  private workspacePath: string;
  private queueFilePath: string;

  constructor(
    workspacePath: string,
    private taskRepo: TaskRepository,
    private queueManager: QueueManager
  ) {
    this.workspacePath = workspacePath;
    this.queueFilePath = join(workspacePath, '.qlaude', 'queue');
  }

  /**
   * Sync queued tasks from SQLite to the .qlaude/queue file and reload QueueManager
   */
  syncToEngine(): void {
    const queuedTasks = this.taskRepo.listQueued(this.workspacePath);

    const lines = queuedTasks
      .map(taskToQueueLine)
      .filter((line): line is string => line !== null);

    const content = lines.join('\n') + (lines.length > 0 ? '\n' : '');

    mkdirSync(join(this.workspacePath, '.qlaude'), { recursive: true });
    writeFileSync(this.queueFilePath, content, 'utf-8');

    // Reload QueueManager to pick up the new file
    this.queueManager.reload().catch(() => {
      // Ignore reload errors - queue file may not exist yet
    });
  }

  /**
   * Called when the engine starts executing a task
   */
  onItemStarted(executionId: string, taskId: string): void {
    this.taskRepo.update(taskId, {
      status: 'running',
      started_at: new Date().toISOString(),
      execution_id: executionId,
    });
  }

  /**
   * Called when the engine completes a task
   */
  onItemCompleted(taskId: string): void {
    this.taskRepo.markCompleted(taskId);
  }

  /**
   * Called when the engine fails a task
   */
  onItemFailed(taskId: string, reason: string): void {
    this.taskRepo.markFailed(taskId, reason);
  }
}
