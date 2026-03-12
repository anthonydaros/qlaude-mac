import { useState, useCallback } from 'react';
import type { Task } from '../types/global';

export interface UseTasksResult {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches tasks for the given workspace path.
 * Returns empty array when workspacePath is not set.
 */
export function useTasks(workspacePath: string | null): UseTasksResult {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!workspacePath) {
      setTasks([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await window.qlaude.tasks.list(workspacePath);
      setTasks(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  return { tasks, loading, error, refetch };
}
