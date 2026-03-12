import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { platform, homedir } from 'os';
import { initDatabase } from './db/database.js';
import { TaskRepository } from './db/task-repository.js';
import { SettingsRepository } from './db/settings-repository.js';
import { TelegramRepository } from './db/telegram-repository.js';
import { EngineManager } from './engine/engine-manager.js';
import { QueueSyncAdapter } from './adapters/queue-sync.js';
import { registerIpcHandlers, forwardEngineEvents } from './ipc/handlers.js';

// Platform guard: macOS only
if (platform() !== 'darwin') {
  console.error('qlaude Desktop requires macOS.');
  app.quit();
}

// Database path: ~/Library/Application Support/qlaude/qlaude.db
const dbPath = join(app.getPath('userData'), 'qlaude.db');
const db = initDatabase(dbPath);

const taskRepo = new TaskRepository(db);
const settingsRepo = new SettingsRepository(db);
const telegramRepo = new TelegramRepository(db);

let workspacePath = homedir();
let engine: EngineManager | null = null;
let win: BrowserWindow;

function createQueueSync(): QueueSyncAdapter {
  const queueManager = engine?.getQueueManager();
  if (!queueManager) throw new Error('Engine not initialized');
  return new QueueSyncAdapter(workspacePath, taskRepo, queueManager);
}

function createWindow(): BrowserWindow {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    show: false,
    backgroundColor: '#1a1a2e',
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Open external links in browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  win = createWindow();

  // Lazy queue sync: will be recreated when engine is initialized
  let queueSync: QueueSyncAdapter;

  registerIpcHandlers({
    getEngine: () => engine,
    taskRepo,
    settingsRepo,
    telegramRepo,
    get queueSync() {
      if (!queueSync) queueSync = createQueueSync();
      return queueSync;
    },
    getWorkspacePath: () => workspacePath,
    setWorkspacePath: (path) => {
      workspacePath = path;
      // Re-initialize engine for new workspace
      if (engine) {
        engine.dispose();
        engine = null;
      }
      engine = new EngineManager(path);
      queueSync = createQueueSync();
      forwardEngineEvents(engine, win);
    },
    win,
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  engine?.dispose();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
