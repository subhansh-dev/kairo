import { resolve, relative, join, basename, dirname, extname, sep } from 'path';
import { existsSync, statSync } from 'fs';

export function isSubPath(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return !rel.startsWith('..') && !relative(parent, child).startsWith('..');
}

export function findProjectRoot(startDir?: string): string | null {
  let dir = startDir || process.cwd();
  const markers = ['.git', 'package.json', 'tsconfig.json', 'Cargo.toml', 'go.mod', 'pyproject.toml'];
  const root = process.platform === 'win32' ? dir.split(sep)[0] + sep : '/';
  let maxDepth = 10;

  while (dir !== root && maxDepth > 0) {
    for (const marker of markers) {
      if (existsSync(join(dir, marker))) return dir;
    }
    dir = dirname(dir);
    maxDepth--;
  }
  return null;
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function getFileExtension(filePath: string): string {
  return extname(filePath).toLowerCase();
}

export function getRelativePath(from: string, to: string): string {
  return relative(from, to);
}

export function pathDepth(p: string): number {
  return normalizePath(p).split('/').length;
}

export function commonBasePath(paths: string[]): string {
  if (paths.length === 0) return '';
  if (paths.length === 1) return dirname(paths[0]);

  const normalized = paths.map(normalizePath);
  let common = normalized[0].split('/');

  for (let i = 1; i < normalized.length; i++) {
    const parts = normalized[i].split('/');
    const newCommon: string[] = [];
    for (let j = 0; j < Math.min(common.length, parts.length); j++) {
      if (common[j] === parts[j]) newCommon.push(common[j]);
      else break;
    }
    common = newCommon;
  }

  return common.join('/');
}

/**
 * Gets the directory path for a given file or directory path.
 * If the path is a directory, returns the path itself.
 * If the path is a file or doesn't exist, returns the parent directory.
 */
export function getDirectoryForPath(path: string): string {
  const absolutePath = resolve(path)
  // Skip filesystem operations for UNC paths
  if (absolutePath.startsWith('\\\\') || absolutePath.startsWith('//')) {
    return dirname(absolutePath)
  }
  try {
    const stats = statSync(absolutePath)
    if (stats.isDirectory()) {
      return absolutePath
    }
  } catch {
    // Path doesn't exist or can't be accessed
  }
  return dirname(absolutePath)
}

/**
 * Expands a path that may contain tilde notation (~) to an absolute path.
 */
export function expandPath(path: string, baseDir?: string): string {
  const actualBaseDir = baseDir ?? process.cwd()
  if (typeof path !== 'string') {
    throw new TypeError(`Path must be a string, received ${typeof path}`)
  }
  const trimmedPath = path.trim()
  if (!trimmedPath) {
    return resolve(actualBaseDir)
  }
  if (trimmedPath === '~') {
    return homedir()
  }
  if (trimmedPath.startsWith('~/')) {
    return join(homedir(), trimmedPath.slice(2))
  }
  if (isAbsolute(trimmedPath)) {
    return resolve(trimmedPath)
  }
  return resolve(actualBaseDir, trimmedPath)
}

/**
 * Checks if a path contains directory traversal patterns.
 */
export function containsPathTraversal(path: string): boolean {
  return /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(path)
}

/**
 * Sanitize a path for safe display.
 */
export function sanitizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

import { homedir } from 'os'
import { isAbsolute } from 'path'
