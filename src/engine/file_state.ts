/**
 * File state tracking for session rewind.
 *
 * Captures and restores file states at specific points during a session.
 * Each "rewind point" corresponds to a user prompt and stores snapshots
 * of all files that were read or modified.
 */

export interface FileSnapshot {
  path: string;
  content: string;
  hash: string;
  timestamp: number;
  isRelative: boolean;
}

export interface RewindPoint {
  promptIndex: number;
  snapshots: Map<string, FileSnapshot>;
  timestamp: number;
}

export interface FileRewindResponse {
  restored: string[];
  failed: string[];
}

/**
 * Create a new empty rewind point.
 */
export function createRewindPoint(promptIndex: number): RewindPoint {
  return {
    promptIndex,
    snapshots: new Map(),
    timestamp: Date.now(),
  };
}

/**
 * Add a file snapshot to a rewind point.
 */
export function addSnapshot(
  point: RewindPoint,
  filePath: string,
  content: string,
  isRelative: boolean = true
): void {
  point.snapshots.set(filePath, {
    path: filePath,
    content,
    hash: simpleHash(content),
    timestamp: Date.now(),
    isRelative,
  });
}

/**
 * Rewind files to a specific rewind point.
 */
export async function rewindFiles(
  point: RewindPoint,
  cwd: string,
  fs: {
    writeFile: (path: string, content: string) => Promise<void>;
    readFile: (path: string) => Promise<string>;
  }
): Promise<FileRewindResponse> {
  const restored: string[] = [];
  const failed: string[] = [];

  for (const [filePath, snapshot] of point.snapshots) {
    const fullPath = snapshot.isRelative
      ? `${cwd}/${filePath}`
      : filePath;

    try {
      await fs.writeFile(fullPath, snapshot.content);
      restored.push(filePath);
    } catch (err) {
      failed.push(filePath);
    }
  }

  return { restored, failed };
}

/**
 * Get a summary of changes in a rewind point.
 */
export function getRewindSummary(point: RewindPoint): {
  totalFiles: number;
  totalSize: number;
} {
  let totalSize = 0;
  for (const snapshot of point.snapshots.values()) {
    totalSize += snapshot.content.length;
  }

  return {
    totalFiles: point.snapshots.size,
    totalSize,
  };
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return hash.toString(36);
}
