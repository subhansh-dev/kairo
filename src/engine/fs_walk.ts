/**
 * Filesystem walk primitives.
 *
 * Shared walk configuration and utilities for list/read ops.
 * Supports depth limiting, glob filtering, gitignore respect,
 * and binary-safe ranged reads.
 */

import * as fs from 'fs';
import * as path from 'path';

export const MAX_LIST_COLLECT = 50_000;
export const MAX_READ_BYTES = 4 * 1024 * 1024; // 4 MiB

export interface FsWalkOptions {
  depth: number;
  followSymlinks: boolean;
  respectGitIgnore: boolean;
  includeHidden: boolean;
  includeGlobs: string[];
  excludeGlobs: string[];
  confineToCanonicalRoot?: string;
}

export interface RawFsEntry {
  path: string;
  name: string;
  isSymlink: boolean;
  isDirectory: boolean;
  size: number;
  mtime: number;
}

/**
 * Clamp read length to valid bounds.
 */
export function clampReadLength(length: number | undefined, maxBytes: number): number {
  return Math.min(length ?? Infinity, maxBytes, MAX_READ_BYTES);
}

/**
 * Check if a file matches any glob pattern.
 */
function matchesGlob(name: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  return patterns.some(pattern => {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(name);
  });
}

/**
 * Check if a file should be excluded.
 */
function isExcluded(name: string, excludeGlobs: string[]): boolean {
  return excludeGlobs.some(pattern => {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(name);
  });
}

/**
 * Check if a .gitignore entry should be ignored.
 */
function shouldIgnoreByGitignore(filePath: string, rootPath: string): boolean {
  // Simple heuristic: check common gitignore patterns
  const relPath = path.relative(rootPath, filePath);
  const parts = relPath.split(path.sep);

  // Check for common ignored directories
  const ignoredDirs = ['node_modules', '.git', 'target', '__pycache__', '.next', 'dist', 'build'];
  return parts.some(part => ignoredDirs.includes(part));
}

/**
 * Walk a directory and collect entries.
 */
export function walkFsEntries(
  absDir: string,
  opts: FsWalkOptions,
  maxEntries: number = MAX_LIST_COLLECT
): { entries: RawFsEntry[]; hitCap: boolean } {
  const entries: RawFsEntry[] = [];
  let hitCap = false;

  function walk(dir: string, currentDepth: number) {
    if (currentDepth > opts.depth || entries.length >= maxEntries) {
      hitCap = true;
      return;
    }

    let dirEntries: fs.Dirent[];
    try {
      dirEntries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of dirEntries) {
      if (entries.length >= maxEntries) {
        hitCap = true;
        return;
      }

      if (!opts.includeHidden && entry.name.startsWith('.')) continue;
      if (isExcluded(entry.name, opts.excludeGlobs)) continue;

      const fullPath = path.join(dir, entry.name);

      // Gitignore check
      if (opts.respectGitIgnore && shouldIgnoreByGitignore(fullPath, absDir)) {
        continue;
      }

      // Glob filter
      if (!matchesGlob(entry.name, opts.includeGlobs)) continue;

      // Confine check
      if (opts.confineToCanonicalRoot) {
        const canonical = path.resolve(fullPath);
        const rootCanonical = path.resolve(opts.confineToCanonicalRoot);
        if (!canonical.startsWith(rootCanonical)) continue;
      }

      try {
        const stat = fs.lstatSync(fullPath);
        entries.push({
          path: fullPath,
          name: entry.name,
          isSymlink: stat.isSymbolicLink(),
          isDirectory: entry.isDirectory(),
          size: stat.size,
          mtime: stat.mtimeMs,
        });

        if (entry.isDirectory() && currentDepth < opts.depth) {
          walk(fullPath, currentDepth + 1);
        }
      } catch {
        // Skip unreadable entries
      }
    }
  }

  walk(absDir, 0);
  return { entries, hitCap };
}

/**
 * Read a file range as text.
 */
export function readRange(filePath: string, offset: number, length: number): string {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, offset);
    return buffer.slice(0, bytesRead).toString('utf-8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Encode a chunk as base64.
 */
export function encodeChunk(data: Buffer): string {
  return data.toString('base64');
}
