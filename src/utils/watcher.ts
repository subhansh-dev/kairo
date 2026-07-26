/**
 * Kairo — File Change Watcher
 */

import { watch, type FSWatcher } from 'fs';
import { join, relative } from 'path';
import { debounce } from './debounce.js';

export type FileChangeType = 'change' | 'rename';

export interface FileChangeEvent {
  type: FileChangeType;
  filePath: string;
  timestamp: number;
}

export type FileChangeCallback = (event: FileChangeEvent) => void;

export class FileWatcher {
  private watchers: Map<string, FSWatcher> = new Map();
  private callbacks: FileChangeCallback[] = [];
  private watchDir: string;
  private debouncedNotify: (events: FileChangeEvent[]) => void;
  private pendingEvents: FileChangeEvent[] = [];

  constructor(watchDir: string, debounceMs: number = 300) {
    this.watchDir = watchDir;
    this.debouncedNotify = debounce((events: FileChangeEvent[]) => {
      for (const event of events) {
        for (const cb of this.callbacks) {
          cb(event);
        }
      }
      this.pendingEvents = [];
    }, debounceMs);
  }

  onFileChanged(callback: FileChangeCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback);
    };
  }

  watch(path: string): void {
    if (this.watchers.has(path)) return;

    try {
      const watcher = watch(path, (eventType, filename) => {
        if (!filename) return;
        const relPath = relative(this.watchDir, join(path, filename.toString()));
        this.pendingEvents.push({
          type: eventType as FileChangeType,
          filePath: relPath,
          timestamp: Date.now(),
        });
        this.debouncedNotify(this.pendingEvents);
      });

      this.watchers.set(path, watcher);
    } catch {}
  }

  watchDirectory(dir: string): void {
    this.watch(dir);
  }

  close(): void {
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
    this.callbacks = [];
  }
}
