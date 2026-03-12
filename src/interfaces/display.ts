import type { QueueItem, MessageType } from '../types/index.js';

export interface IDisplay {
  showMessage(type: MessageType, message: string): void;
  updateStatusBar(items: QueueItem[]): void;
  setPaused(paused: boolean): void;
  setCurrentItem(item: QueueItem | null): void;
  toggle(): boolean;
  clear(): void;
  getHeight(): number;
}
