/**
 * File utilities — safe file I/O operations.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Safely read a file, returning null on error.
 */
export function safeReadFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Safely write a file, creating directories as needed.
 */
export function safeWriteFile(filePath: string, content: string): boolean {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely delete a file.
 */
export function safeDeleteFile(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check if a file exists.
 */
export function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

/**
 * Get file stats safely.
 */
export function safeStat(filePath: string): fs.Stats | null {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

/**
 * List files in a directory safely.
 */
export function safeListDir(dirPath: string): string[] {
  try {
    return fs.readdirSync(dirPath);
  } catch {
    return [];
  }
}

/**
 * Recursively list all files in a directory.
 */
export function listAllFiles(dirPath: string, extensions?: string[]): string[] {
  const result: string[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        result.push(...listAllFiles(fullPath, extensions));
      } else if (entry.isFile()) {
        if (!extensions || extensions.some(ext => entry.name.endsWith(ext))) {
          result.push(fullPath);
        }
      }
    }
  } catch {
    // Best effort
  }

  return result;
}

/**
 * Get file size in bytes.
 */
export function getFileSize(filePath: string): number | null {
  const stat = safeStat(filePath);
  return stat?.size ?? null;
}

/**
 * Read a file as JSON safely.
 */
export function readJsonFile<T = unknown>(filePath: string): T | null {
  const content = safeReadFile(filePath);
  if (content === null) return null;
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Write a JSON file safely.
 */
export function writeJsonFile(filePath: string, data: unknown): boolean {
  try {
    return safeWriteFile(filePath, JSON.stringify(data, null, 2));
  } catch {
    return false;
  }
}

/**
 * Copy a file safely.
 */
export function safeCopyFile(src: string, dest: string): boolean {
  try {
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.copyFileSync(src, dest);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a temporary file path.
 */
export function tempPath(extension: string = '.tmp'): string {
  return path.join(
    process.env.TEMP || process.env.TMPDIR || '/tmp',
    `kairo-${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`,
  );
}
