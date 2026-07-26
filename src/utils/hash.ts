/**
 * Kairo — Shared Hash & Path Utilities
 * Deduplicates contentHash() and resolvePath() from file-read, file-write, file-edit, checkpoint, enhanced
 */

import * as crypto from 'crypto';
import { join, isAbsolute } from 'path';
import { homedir } from 'os';

/** SHA-256 content hash, truncated to 16 hex chars (64 bits — collision-safe for conflict detection) */
export function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** Expand ~ to home directory and resolve relative paths against cwd */
export function resolvePath(p: string): string {
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return join(homedir(), p.slice(2));
  }
  if (!isAbsolute(p)) {
    return join(process.cwd(), p);
  }
  return p;
}
