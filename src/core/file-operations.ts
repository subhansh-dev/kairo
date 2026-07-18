/**
 * File operations — safe file manipulation utilities.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'fs';
import { dirname, resolve, normalize } from 'path';

/**
 * Read a file safely with fallback.
 */
export function safeReadFile(path: string, fallback = ''): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return fallback;
  }
}

/**
 * Write a file, creating directories as needed.
 */
export function safeWriteFile(path: string, content: string): boolean {
  try {
    const dir = dirname(resolve(path));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, content, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Backup a file before modifying it.
 */
export function backupFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const backupPath = `${path}.bak.${Date.now()}`;
    copyFileSync(path, backupPath);
    return backupPath;
  } catch {
    return null;
  }
}

/**
 * Write a file atomically (write to temp + rename).
 */
export function atomicWrite(path: string, content: string): boolean {
  try {
    const { renameSync, unlinkSync } = require('fs');
    const tmpPath = `${path}.tmp.${Date.now()}`;
    writeFileSync(tmpPath, content, 'utf-8');
    try {
      renameSync(tmpPath, path);
    } catch {
      // Cross-device rename fallback
      copyFileSync(tmpPath, path);
      unlinkSync(tmpPath);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a file path for consistent comparison.
 */
export function normalizePath(path: string): string {
  return normalize(resolve(path));
}

/**
 * Check if a file exists and is readable.
 */
export function isReadable(path: string): boolean {
  try {
    const { accessSync, constants } = require('fs');
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get file extension (including dot).
 */
export function getExtension(path: string): string {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return '';
  return path.slice(lastDot);
}

/**
 * Check if a path is a hidden file (starts with dot).
 */
export function isHiddenFile(path: string): boolean {
  const parts = path.split('/');
  return parts.some(p => p.startsWith('.') && p !== '.' && p !== '..');
}
