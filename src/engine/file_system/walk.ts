/**
 * Filesystem walk — directory traversal utilities.
 *
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface WalkOptions {
  maxDepth?: number;
  followSymlinks?: boolean;
  ignorePatterns?: string[];
  fileExtensions?: string[];
  maxFileSize?: number;
}

export interface WalkEntry {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink';
  depth: number;
  size?: number;
}

const DEFAULT_MAX_DEPTH = 50;
const DEFAULT_IGNORE = ['.git', 'node_modules', '__pycache__', '.next', 'dist', 'build'];

/**
 * Walk a directory tree recursively.
 */
export async function* walkDir(
  dirPath: string,
  options: WalkOptions = {}
): AsyncGenerator<WalkEntry> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const ignore = options.ignorePatterns ?? DEFAULT_IGNORE;

  yield* walkDirInternal(dirPath, 0, maxDepth, ignore, options);
}

async function* walkDirInternal(
  dirPath: string,
  currentDepth: number,
  maxDepth: number,
  ignore: string[],
  options: WalkOptions
): AsyncGenerator<WalkEntry> {
  if (currentDepth >= maxDepth) return;

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (ignore.includes(entry.name)) continue;
    if (entry.name.startsWith('.') && entry.name !== '.env') continue;

    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      yield { path: entryPath, name: entry.name, type: 'directory', depth: currentDepth };
      yield* walkDirInternal(entryPath, currentDepth + 1, maxDepth, ignore, options);
    } else if (entry.isSymbolicLink()) {
      yield { path: entryPath, name: entry.name, type: 'symlink', depth: currentDepth };
    } else if (entry.isFile()) {
      if (options.fileExtensions) {
        const ext = path.extname(entry.name).toLowerCase();
        if (!options.fileExtensions.includes(ext)) continue;
      }

      if (options.maxFileSize) {
        try {
          const stat = await fs.stat(entryPath);
          if (stat.size > options.maxFileSize) continue;
          yield { path: entryPath, name: entry.name, type: 'file', depth: currentDepth, size: stat.size };
        } catch {
          continue;
        }
      } else {
        yield { path: entryPath, name: entry.name, type: 'file', depth: currentDepth };
      }
    }
  }
}

/**
 * Collect all entries from a walk.
 */
export async function walkDirCollect(
  dirPath: string,
  options: WalkOptions = {}
): Promise<WalkEntry[]> {
  const entries: WalkEntry[] = [];
  for await (const entry of walkDir(dirPath, options)) {
    entries.push(entry);
  }
  return entries;
}

/**
 * Count files in a directory tree.
 */
export async function countFiles(dirPath: string, options: WalkOptions = {}): Promise<number> {
  let count = 0;
  for await (const entry of walkDir(dirPath, options)) {
    if (entry.type === 'file') count++;
  }
  return count;
}

/**
 * Find files matching a pattern.
 */
export async function findFiles(
  dirPath: string,
  pattern: RegExp,
  options: WalkOptions = {}
): Promise<string[]> {
  const matches: string[] = [];
  for await (const entry of walkDir(dirPath, options)) {
    if (entry.type === 'file' && pattern.test(entry.name)) {
      matches.push(entry.path);
    }
  }
  return matches;
}
