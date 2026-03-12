import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

const qlaude = {
  // Health check
  health: {
    check: () => ipcRenderer.invoke('health:check'),
  },

  // Task management
  tasks: {
    list: (workspacePath: string) => ipcRenderer.invoke('tasks:list', workspacePath),
    create: (task: unknown) => ipcRenderer.invoke('tasks:create', task),
    update: (id: string, fields: unknown) => ipcRenderer.invoke('tasks:update', id, fields),
    delete: (id: string) => ipcRenderer.invoke('tasks:delete', id),
    reorder: (id: string, newOrder: number) => ipcRenderer.invoke('tasks:reorder', id, newOrder),
  },

  // Queue management
  queue: {
    start: (workspacePath: string) => ipcRenderer.invoke('queue:start', workspacePath),
    pause: () => ipcRenderer.invoke('queue:pause'),
    resume: () => ipcRenderer.invoke('queue:resume'),
    reload: () => ipcRenderer.invoke('queue:reload'),
  },

  // Execution streaming
  execution: {
    subscribe: (callback: (data: unknown) => void) => {
      const handler = (_event: IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('execution:data', handler);
      return () => ipcRenderer.off('execution:data', handler);
    },
    onStateChange: (callback: (state: unknown) => void) => {
      const handler = (_event: IpcRendererEvent, state: unknown) => callback(state);
      ipcRenderer.on('execution:state', handler);
      return () => ipcRenderer.off('execution:state', handler);
    },
    onTaskStatus: (callback: (status: unknown) => void) => {
      const handler = (_event: IpcRendererEvent, status: unknown) => callback(status);
      ipcRenderer.on('execution:taskStatus', handler);
      return () => ipcRenderer.off('execution:taskStatus', handler);
    },
  },

  // Workspace
  workspace: {
    open: () => ipcRenderer.invoke('workspace:open'),
    get: () => ipcRenderer.invoke('workspace:get'),
  },

  // Telegram configuration
  telegram: {
    validateToken: (token: string) => ipcRenderer.invoke('telegram:validateToken', token),
    detectChatId: (token: string) => ipcRenderer.invoke('telegram:detectChatId', token),
    testConnection: () => ipcRenderer.invoke('telegram:testConnection'),
    saveConfig: (config: unknown) => ipcRenderer.invoke('telegram:saveConfig', config),
    getStatus: () => ipcRenderer.invoke('telegram:getStatus'),
  },

  // Onboarding
  onboarding: {
    getStatus: () => ipcRenderer.invoke('onboarding:getStatus'),
    complete: () => ipcRenderer.invoke('onboarding:complete'),
  },

  // Logs
  logs: {
    list: () => ipcRenderer.invoke('logs:list'),
    get: (logId: string) => ipcRenderer.invoke('logs:get', logId),
  },
};

contextBridge.exposeInMainWorld('qlaude', qlaude);

export type QlaudeAPI = typeof qlaude;
