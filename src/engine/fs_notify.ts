/**
 * FsNotify adapter — bridges filesystem events to workspace subsystems.
 *
 */

import * as path from 'path';

export enum FsEventKind {
  Created = 'created',
  Modified = 'modified',
  Removed = 'removed',
  Renamed = 'renamed',
}

export interface FsEvent {
  paths: string[];
  kind: FsEventKind;
}

export interface HunkTrackerHandle {
  handleFileChange(filePath: string): void;
  handleFileDeleted(filePath: string): void;
}

export interface CodebaseGraphHandle {
  handleFileEvent(event: FileEvent): void;
}

export interface FileEvent {
  paths: string[];
  kind: FileEventKind;
}

export enum FileEventKind {
  Created = 'created',
  Modified = 'modified',
  Removed = 'removed',
  Renamed = 'renamed',
}

/**
 * True if path lies under a hidden component below cwd.
 */
export function isUnderHiddenDir(filePath: string, cwd: string): boolean {
  const rel = path.relative(cwd, filePath);
  const parts = rel.split(path.sep);
  return parts.some(p => p.startsWith('.') && p.length > 1);
}

/**
 * Forward an fs event to the hunk tracker.
 * Hidden-directory paths are filtered out.
 */
export function forwardToHunkTracker(
  paths: string[],
  kind: FsEventKind,
  handle: HunkTrackerHandle,
  cwd: string
): void {
  for (const p of paths) {
    if (isUnderHiddenDir(p, cwd)) continue;

    switch (kind) {
      case FsEventKind.Created:
      case FsEventKind.Modified:
      case FsEventKind.Renamed:
        handle.handleFileChange(p);
        break;
      case FsEventKind.Removed:
        handle.handleFileDeleted(p);
        break;
    }
  }
}

/**
 * Convert FsEvent to CodebaseGraph FileEvent.
 */
export function fsEventToCodebaseGraphEvent(
  paths: string[],
  kind: FsEventKind
): FileEvent {
  return { paths, kind: kind as unknown as FileEventKind };
}

/**
 * Convert FsEventKind to workspace event kind string.
 */
export function toWorkspaceEventKind(kind: FsEventKind): string {
  return kind;
}

/**
 * Create a filesystem watcher that forwards events to workspace subsystems.
 */
export function createFsEventForwarder(
  cwd: string,
  hunkTracker?: HunkTrackerHandle,
  codebaseGraph?: CodebaseGraphHandle,
  onFsChanged?: (paths: string[]) => void
): (event: FsEvent) => void {
  return (event: FsEvent) => {
    if (hunkTracker) {
      forwardToHunkTracker(event.paths, event.kind, hunkTracker, cwd);
    }

    if (codebaseGraph) {
      const graphEvent = fsEventToCodebaseGraphEvent(event.paths, event.kind);
      codebaseGraph.handleFileEvent(graphEvent);
    }

    if (onFsChanged) {
      onFsChanged(event.paths);
    }
  };
}
