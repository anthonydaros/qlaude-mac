import { ipcMain, dialog, BrowserWindow } from 'electron';
import { basename } from 'path';
import { app } from 'electron';
import type { EngineManager } from '../engine/engine-manager.js';
import type { TaskRepository } from '../db/task-repository.js';
import type { SettingsRepository } from '../db/settings-repository.js';
import type { TelegramRepository } from '../db/telegram-repository.js';
import type { QueueSyncAdapter } from '../adapters/queue-sync.js';
import type { CreateTaskPayload, UpdateTaskPayload, HealthCheckResult, WorkspaceInfo } from './types.js';

interface HandlerDeps {
  getEngine: () => EngineManager | null;
  taskRepo: TaskRepository;
  settingsRepo: SettingsRepository;
  telegramRepo: TelegramRepository;
  queueSync: QueueSyncAdapter;
  getWorkspacePath: () => string;
  setWorkspacePath: (path: string) => void;
  win: BrowserWindow;
}

export function registerIpcHandlers(deps: HandlerDeps): void {
  const { getEngine, taskRepo, settingsRepo, telegramRepo, queueSync, win } = deps;

  // Health check
  ipcMain.handle('health:check', (): HealthCheckResult => ({
    ok: true,
    version: app.getVersion(),
    platform: process.platform,
  }));

  // Task management
  ipcMain.handle('tasks:list', (_event, workspacePath: string) => {
    return taskRepo.listByWorkspace(workspacePath);
  });

  ipcMain.handle('tasks:create', (_event, payload: CreateTaskPayload) => {
    const task = taskRepo.create({
      workspace_path: payload.workspace_path,
      title: payload.title,
      prompt: payload.prompt,
      is_new_session: payload.is_new_session ? 1 : 0,
      model_name: payload.model_name ?? null,
      delay_ms: payload.delay_ms ?? null,
      is_breakpoint: payload.is_breakpoint ? 1 : 0,
      label_session: payload.label_session ?? null,
      load_session_label: payload.load_session_label ?? null,
    });
    queueSync.syncToEngine();
    return task;
  });

  ipcMain.handle('tasks:update', (_event, id: string, fields: UpdateTaskPayload) => {
    const task = taskRepo.update(id, fields);
    queueSync.syncToEngine();
    return task;
  });

  ipcMain.handle('tasks:delete', (_event, id: string) => {
    const ok = taskRepo.delete(id);
    queueSync.syncToEngine();
    return ok;
  });

  ipcMain.handle('tasks:reorder', (_event, id: string, newOrder: number) => {
    taskRepo.reorder(id, newOrder);
    queueSync.syncToEngine();
    return true;
  });

  // Queue management
  ipcMain.handle('queue:start', async (_event, workspacePath: string) => {
    const engine = getEngine();
    if (!engine) return { ok: false, error: 'Engine not initialized' };
    await engine.start([]);
    return { ok: true };
  });

  ipcMain.handle('queue:pause', () => {
    getEngine()?.pause();
    return { ok: true };
  });

  ipcMain.handle('queue:resume', () => {
    getEngine()?.resume();
    return { ok: true };
  });

  ipcMain.handle('queue:reload', async () => {
    await getEngine()?.reloadQueue();
    return { ok: true };
  });

  // Workspace
  ipcMain.handle('workspace:open', async (): Promise<WorkspaceInfo | null> => {
    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory'],
      title: 'Select Workspace',
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const selectedPath = result.filePaths[0];
    deps.setWorkspacePath(selectedPath);
    return { path: selectedPath, name: basename(selectedPath) };
  });

  ipcMain.handle('workspace:get', (): WorkspaceInfo => {
    const path = deps.getWorkspacePath();
    return { path, name: basename(path) };
  });

  // Telegram
  ipcMain.handle('telegram:validateToken', async (_event, token: string) => {
    try {
      const { validateBotToken } = await import('../../utils/setup-wizard.js');
      return await validateBotToken(token);
    } catch {
      return null;
    }
  });

  ipcMain.handle('telegram:detectChatId', async (_event, token: string) => {
    try {
      const { detectChatId } = await import('../../utils/setup-wizard.js');
      return await detectChatId(token);
    } catch {
      return null;
    }
  });

  ipcMain.handle('telegram:testConnection', async () => {
    const config = telegramRepo.get();
    if (!config.bot_token || !config.chat_id) return { ok: false, error: 'Not configured' };
    try {
      const url = `https://api.telegram.org/bot${config.bot_token}/sendMessage`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: config.chat_id, text: '✅ qlaude Desktop connected!' }),
      });
      return { ok: res.ok };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle('telegram:saveConfig', (_event, config: { botToken: string; chatId: string }) => {
    telegramRepo.update({
      bot_token: config.botToken,
      chat_id: config.chatId,
      validated: true,
      enabled: true,
    });
    return { ok: true };
  });

  ipcMain.handle('telegram:getStatus', () => {
    return telegramRepo.get();
  });

  // Onboarding
  ipcMain.handle('onboarding:getStatus', () => {
    const completed = settingsRepo.get('onboarding_completed');
    return { completed: completed === 'true' };
  });

  ipcMain.handle('onboarding:complete', () => {
    settingsRepo.set('onboarding_completed', 'true');
    return { ok: true };
  });

  // Logs (placeholder)
  ipcMain.handle('logs:list', () => []);
  ipcMain.handle('logs:get', () => null);
}

export function forwardEngineEvents(engine: EngineManager, win: BrowserWindow): void {
  engine.on('pty_data', (data: string) => {
    if (!win.isDestroyed()) {
      win.webContents.send('execution:data', data);
    }
  });

  engine.on('state_change', (state) => {
    if (!win.isDestroyed()) {
      win.webContents.send('execution:state', state);
    }
  });

  engine.on('task_status', (status) => {
    if (!win.isDestroyed()) {
      win.webContents.send('execution:taskStatus', status);
    }
  });
}
