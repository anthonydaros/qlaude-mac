import { randomUUID } from 'crypto';
import type { DB } from './database.js';

export interface Task {
  id: string;
  workspace_path: string;
  title: string;
  prompt: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'paused';
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  failed_reason: string | null;
  is_new_session: 0 | 1;
  model_name: string | null;
  delay_ms: number | null;
  is_breakpoint: 0 | 1;
  label_session: string | null;
  load_session_label: string | null;
  execution_id: string | null;
  sort_order: number;
}

export type CreateTaskInput = Pick<Task, 'workspace_path' | 'prompt'> & Partial<Omit<Task,
  'id' | 'created_at' | 'updated_at' | 'started_at' | 'completed_at' | 'execution_id'
>>;

export type UpdateTaskInput = Partial<Omit<Task, 'id' | 'created_at' | 'workspace_path'>>;

export class TaskRepository {
  constructor(private db: DB) {}

  create(input: CreateTaskInput): Task {
    const id = randomUUID();
    const maxOrder = this.db
      .prepare('SELECT MAX(sort_order) as max FROM tasks WHERE workspace_path = ?')
      .get(input.workspace_path) as { max: number | null };
    const sortOrder = (maxOrder.max ?? -1) + 1;

    this.db.prepare(`
      INSERT INTO tasks (
        id, workspace_path, title, prompt, status,
        is_new_session, model_name, delay_ms, is_breakpoint,
        label_session, load_session_label, sort_order
      ) VALUES (
        @id, @workspace_path, @title, @prompt, @status,
        @is_new_session, @model_name, @delay_ms, @is_breakpoint,
        @label_session, @load_session_label, @sort_order
      )
    `).run({
      '@id': id,
      '@workspace_path': input.workspace_path,
      '@title': input.title ?? '',
      '@prompt': input.prompt,
      '@status': input.status ?? 'queued',
      '@is_new_session': input.is_new_session ?? 0,
      '@model_name': input.model_name ?? null,
      '@delay_ms': input.delay_ms ?? null,
      '@is_breakpoint': input.is_breakpoint ?? 0,
      '@label_session': input.label_session ?? null,
      '@load_session_label': input.load_session_label ?? null,
      '@sort_order': sortOrder,
    });

    return this.getById(id)!;
  }

  getById(id: string): Task | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
  }

  listByWorkspace(workspacePath: string, statusFilter?: Task['status'][]): Task[] {
    if (statusFilter && statusFilter.length > 0) {
      const placeholders = statusFilter.map(() => '?').join(',');
      return this.db
        .prepare(`SELECT * FROM tasks WHERE workspace_path = ? AND status IN (${placeholders}) ORDER BY sort_order ASC, created_at ASC`)
        .all(workspacePath, ...statusFilter) as Task[];
    }
    return this.db
      .prepare('SELECT * FROM tasks WHERE workspace_path = ? ORDER BY sort_order ASC, created_at ASC')
      .all(workspacePath) as Task[];
  }

  listQueued(workspacePath: string): Task[] {
    return this.listByWorkspace(workspacePath, ['queued', 'paused']);
  }

  update(id: string, fields: UpdateTaskInput): Task | undefined {
    const allowed = [
      'title', 'prompt', 'status', 'started_at', 'completed_at',
      'failed_reason', 'is_new_session', 'model_name', 'delay_ms',
      'is_breakpoint', 'label_session', 'load_session_label',
      'execution_id', 'sort_order',
    ];
    const updates = Object.entries(fields)
      .filter(([k]) => allowed.includes(k))
      .map(([k]) => `${k} = @${k}`)
      .join(', ');

    if (!updates) return this.getById(id);

    const prefixedFields = Object.fromEntries(
      Object.entries(fields)
        .filter(([k]) => allowed.includes(k))
        .map(([k, v]) => [`@${k}`, v])
    );
    this.db.prepare(`UPDATE tasks SET ${updates}, updated_at = datetime('now') WHERE id = @id`)
      .run({ ...prefixedFields, '@id': id });

    return this.getById(id);
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
    return result.changes > 0;
  }

  reorder(id: string, newOrder: number): void {
    const task = this.getById(id);
    if (!task) return;

    const oldOrder = task.sort_order;
    if (oldOrder === newOrder) return;

    try {
      this.db.exec('BEGIN');
      if (newOrder > oldOrder) {
        this.db.prepare(
          'UPDATE tasks SET sort_order = sort_order - 1 WHERE workspace_path = ? AND sort_order > ? AND sort_order <= ?'
        ).run(task.workspace_path, oldOrder, newOrder);
      } else {
        this.db.prepare(
          'UPDATE tasks SET sort_order = sort_order + 1 WHERE workspace_path = ? AND sort_order >= ? AND sort_order < ?'
        ).run(task.workspace_path, newOrder, oldOrder);
      }
      this.db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?').run(newOrder, id);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  markRunning(id: string): Task | undefined {
    return this.update(id, {
      status: 'running',
      started_at: new Date().toISOString(),
    });
  }

  markCompleted(id: string): Task | undefined {
    return this.update(id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
  }

  markFailed(id: string, reason: string): Task | undefined {
    return this.update(id, {
      status: 'failed',
      failed_reason: reason,
      completed_at: new Date().toISOString(),
    });
  }
}
