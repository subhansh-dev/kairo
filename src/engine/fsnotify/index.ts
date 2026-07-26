/**
 * File system notifications — watch for file changes.
 */

import * as fs from 'fs';
import * as path from 'path';

export type FsEvent = 'create' | 'modify' | 'delete' | 'rename';

export interface FsNotifyEvent {
  type: FsEvent;
  path: string;
  timestamp: Date;
}

export type FsNotifyCallback = (event: FsNotifyEvent) => void;

export interface FsWatcher {
  watch(dirPath: string, callback: FsNotifyCallback): void;
  unwatch(dirPath: string): void;
  close(): void;
}

/**
 * Create a file system watcher.
 */
export function createFsWatcher(): FsWatcher {
  const watchers = new Map<string, fs.FSWatcher>();

  return {
    watch(dirPath: string, callback: FsNotifyCallback) {
      if (watchers.has(dirPath)) return;

      try {
        const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
          if (!filename) return;

          const event: FsEvent = eventType === 'rename' ? 'rename' : 'modify';
          callback({
            type: event,
            path: path.join(dirPath, filename),
            timestamp: new Date(),
          });
        });

        watchers.set(dirPath, watcher);
      } catch {
        // Best effort
      }
    },

    unwatch(dirPath: string) {
      const watcher = watchers.get(dirPath);
      if (watcher) {
        watcher.close();
        watchers.delete(dirPath);
      }
    },

    close() {
      for (const [, watcher] of watchers) {
        watcher.close();
      }
      watchers.clear();
    },
  };
}

/**
 * Debounce file system events.
 */
export function debounceFsEvents(
  callback: FsNotifyCallback,
  delayMs: number = 300,
): FsNotifyCallback {
  const pending = new Map<string, NodeJS.Timeout>();

  return (event: FsNotifyEvent) => {
    const existing = pending.get(event.path);
    if (existing) clearTimeout(existing);

    pending.set(event.path, setTimeout(() => {
      pending.delete(event.path);
      callback(event);
    }, delayMs));
  };
}
