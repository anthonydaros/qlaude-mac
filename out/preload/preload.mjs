import { contextBridge, ipcRenderer } from "electron";
const qlaude = {
  // Health check
  health: {
    check: () => ipcRenderer.invoke("health:check")
  },
  // Task management
  tasks: {
    list: (workspacePath) => ipcRenderer.invoke("tasks:list", workspacePath),
    create: (task) => ipcRenderer.invoke("tasks:create", task),
    update: (id, fields) => ipcRenderer.invoke("tasks:update", id, fields),
    delete: (id) => ipcRenderer.invoke("tasks:delete", id),
    reorder: (id, newOrder) => ipcRenderer.invoke("tasks:reorder", id, newOrder)
  },
  // Queue management
  queue: {
    start: (workspacePath) => ipcRenderer.invoke("queue:start", workspacePath),
    pause: () => ipcRenderer.invoke("queue:pause"),
    resume: () => ipcRenderer.invoke("queue:resume"),
    reload: () => ipcRenderer.invoke("queue:reload")
  },
  // Execution streaming
  execution: {
    subscribe: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("execution:data", handler);
      return () => ipcRenderer.off("execution:data", handler);
    },
    onStateChange: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on("execution:state", handler);
      return () => ipcRenderer.off("execution:state", handler);
    },
    onTaskStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on("execution:taskStatus", handler);
      return () => ipcRenderer.off("execution:taskStatus", handler);
    }
  },
  // Workspace
  workspace: {
    open: () => ipcRenderer.invoke("workspace:open"),
    get: () => ipcRenderer.invoke("workspace:get")
  },
  // Telegram configuration
  telegram: {
    validateToken: (token) => ipcRenderer.invoke("telegram:validateToken", token),
    detectChatId: (token) => ipcRenderer.invoke("telegram:detectChatId", token),
    testConnection: () => ipcRenderer.invoke("telegram:testConnection"),
    saveConfig: (config) => ipcRenderer.invoke("telegram:saveConfig", config),
    getStatus: () => ipcRenderer.invoke("telegram:getStatus")
  },
  // Onboarding
  onboarding: {
    getStatus: () => ipcRenderer.invoke("onboarding:getStatus"),
    complete: () => ipcRenderer.invoke("onboarding:complete")
  },
  // Logs
  logs: {
    list: () => ipcRenderer.invoke("logs:list"),
    get: (logId) => ipcRenderer.invoke("logs:get", logId)
  }
};
contextBridge.exposeInMainWorld("qlaude", qlaude);
