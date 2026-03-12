import { EventEmitter } from 'events';
import type { IDisplay } from '../../interfaces/display.js';
import type { QueueItem, MessageType } from '../../types/index.js';

export interface DisplayEvents {
  message: (type: MessageType, message: string) => void;
  statusBar: (items: QueueItem[]) => void;
  paused: (paused: boolean) => void;
  currentItem: (item: QueueItem | null) => void;
}

/**
 * IDisplay implementation for Electron that emits events instead of writing ANSI codes.
 * Events are forwarded to the renderer via IPC.
 */
export class ElectronDisplay extends EventEmitter implements IDisplay {
  private paused = false;
  private currentItem: QueueItem | null = null;
  private lastItems: QueueItem[] = [];
  private enabled = true;

  showMessage(type: MessageType, message: string): void {
    this.emit('message', type, message);
  }

  updateStatusBar(items: QueueItem[]): void {
    this.lastItems = items;
    this.emit('statusBar', items);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.emit('paused', paused);
  }

  setCurrentItem(item: QueueItem | null): void {
    this.currentItem = item;
    this.emit('currentItem', item);
    this.updateStatusBar(this.lastItems);
  }

  toggle(): boolean {
    this.enabled = !this.enabled;
    return this.enabled;
  }

  clear(): void {
    // No-op for Electron: no terminal to clear
  }

  getHeight(): number {
    return 0;
  }

  // Expose state for IPC serialization
  getState() {
    return {
      paused: this.paused,
      currentItem: this.currentItem,
      items: this.lastItems,
      enabled: this.enabled,
    };
  }
}
