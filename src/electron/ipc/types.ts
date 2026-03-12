import type { Task } from '../db/task-repository.js';

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

export interface UpdateTaskPayload {
  title?: string;
  prompt?: string;
  status?: Task['status'];
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

export type IpcChannels =
  | 'health:check'
  | 'tasks:list'
  | 'tasks:create'
  | 'tasks:update'
  | 'tasks:delete'
  | 'tasks:reorder'
  | 'queue:start'
  | 'queue:pause'
  | 'queue:resume'
  | 'queue:reload'
  | 'workspace:open'
  | 'workspace:get'
  | 'telegram:validateToken'
  | 'telegram:detectChatId'
  | 'telegram:testConnection'
  | 'telegram:saveConfig'
  | 'telegram:getStatus'
  | 'onboarding:getStatus'
  | 'onboarding:complete'
  | 'logs:list'
  | 'logs:get';

export type IpcEvents =
  | 'execution:data'
  | 'execution:state'
  | 'execution:taskStatus';
