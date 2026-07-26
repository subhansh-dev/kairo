/**
 * External filesystem — filesystem operations for external paths.
 *
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export interface ExtFsNode {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size?: number;
  children?: ExtFsNode[];
}

/**
 * List directory contents recursively with depth limit.
 */
export async function listDirRecursive(
  dirPath: string,
  maxDepth = 3,
  currentDepth = 0
): Promise<ExtFsNode[]> {
  if (currentDepth >= maxDepth) return [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const nodes: ExtFsNode[] = [];

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      const node: ExtFsNode = {
        name: entry.name,
        path: entryPath,
        type: entry.isDirectory() ? 'directory' : entry.isSymbolicLink() ? 'symlink' : 'file',
      };

      if (entry.isDirectory()) {
        if (currentDepth < maxDepth - 1) {
          node.children = await listDirRecursive(entryPath, maxDepth, currentDepth + 1);
        }
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(entryPath);
          node.size = stat.size;
        } catch { /* ignore */ }
      }

      nodes.push(node);
    }

    return nodes;
  } catch {
    return [];
  }
}

/**
 * Read file with size limit and encoding detection.
 */
export async function readFileSafe(
  filePath: string,
  maxSize = 1024 * 1024
): Promise<{ content: string; truncated: boolean }> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > maxSize) {
      // Read partial content
      const fd = await fs.open(filePath, 'r');
      try {
        const buf = Buffer.alloc(maxSize);
        await fd.read(buf, 0, maxSize, 0);
        return { content: buf.toString('utf-8'), truncated: true };
      } finally {
        await fd.close();
      }
    }

    const content = await fs.readFile(filePath, 'utf-8');
    return { content, truncated: false };
  } catch (err: any) {
    throw new Error(`Failed to read ${filePath}: ${err.message}`);
  }
}

/**
 * Safe stat that returns null instead of throwing.
 */
export async function safeStat(filePath: string): Promise<import('fs').Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

/**
 * Check if a path is binary (non-text) by reading first 8KB.
 */
export async function isBinaryFile(filePath: string): Promise<boolean> {
  try {
    const fd = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(8192);
      const { bytesRead } = await fd.read(buf, 0, 8192, 0);
      for (let i = 0; i < bytesRead; i++) {
        if (buf[i] === 0) return true; // null byte = binary
      }
      return false;
    } finally {
      await fd.close();
    }
  } catch {
    return false;
  }
}
