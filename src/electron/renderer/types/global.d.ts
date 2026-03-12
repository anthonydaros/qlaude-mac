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

export interface CreateTaskPayload {
  workspace_path: string;
  title?: string;
  prompt: string;
  is_new_session?: boolean;
  model_name?: string;
  delay_ms?: number;
  is_breakpoint?: boolean;
  label_session?: string;
  load_session_label?: string;
}

export interface HealthCheckResult {
  ok: boolean;
  version: string;
  platform: string;
}

export interface WorkspaceInfo {
  path: string;
  name: string;
}

export interface OnboardingStatus {
  completed: boolean;
}

export interface QlaudeExecutionState {
  type: string;
  timestamp: number;
}

export interface QlaudeAPI {
  health: {
    check: () => Promise<HealthCheckResult>;
  };
  tasks: {
    list: (workspacePath: string) => Promise<Task[]>;
    create: (payload: CreateTaskPayload) => Promise<Task>;
    update: (id: string, fields: Partial<Task>) => Promise<Task>;
    delete: (id: string) => Promise<boolean>;
    reorder: (id: string, newOrder: number) => Promise<boolean>;
  };
  queue: {
    start: (workspacePath: string) => Promise<{ ok: boolean }>;
    pause: () => Promise<{ ok: boolean }>;
    resume: () => Promise<{ ok: boolean }>;
    reload: () => Promise<{ ok: boolean }>;
  };
  execution: {
    subscribe: (callback: (data: unknown) => void) => () => void;
    onStateChange: (callback: (state: QlaudeExecutionState) => void) => () => void;
    onTaskStatus: (callback: (status: unknown) => void) => () => void;
  };
  workspace: {
    open: () => Promise<WorkspaceInfo | null>;
    get: () => Promise<WorkspaceInfo>;
  };
  onboarding: {
    getStatus: () => Promise<OnboardingStatus>;
    complete: () => Promise<{ ok: boolean }>;
  };
  logs: {
    list: () => Promise<unknown[]>;
    get: (logId: string) => Promise<unknown>;
  };
}


