/**
 * Kairo — File Read Tool
 * Reads files with line numbers, content hash, offset/limit support
 */

import { readFile } from 'fs/promises';
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import type { ToolDefinition, ToolResult } from './types.js';
import { checkReadSafety } from '../core/file-safety.js';
import { contentHash, resolvePath } from '../utils/hash.js';

const MAX_LINES = 2000;

function fuzzyResolve(path: string): string | null {
  const resolved = resolvePath(path);
  if (existsSync(resolved)) return resolved;

  for (const ext of ['.ts', '.js', '.tsx', '.jsx', '.py', '.md', '.json', '.yml', '.yaml', '.css', '.html']) {
    if (existsSync(resolved + ext)) return resolved + ext;
  }

  for (const dir of ['src', 'lib', 'app', 'pages', 'components', 'utils', 'tools']) {
    const candidate = join(dir, resolved);
    if (existsSync(candidate)) return candidate;
    for (const ext of ['.ts', '.js', '.tsx', '.jsx']) {
      if (existsSync(candidate + ext)) return candidate + ext;
    }
  }

  return null;
}

export const fileReadTool: ToolDefinition = {
  name: 'read',
  description: 'Read a file with line numbers and content hash. Usage: read <path> [start] [end]',
  prompt: `Reads a file from the local filesystem. Returns content with line numbers and a content hash.

Usage:
- read <path> — read entire file
- read <path> <start_line> <end_line> — read specific range

The content hash is used for conflict detection when writing.
Images (PNG, JPG) are detected and noted.`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      // Parse args: try to resolve path greedily from left, then check if trailing args are line numbers.
      // Only treat trailing args as line numbers if the path doesn't exist as-is.
      const parts = args.trim().split(/\s+/);
      if (parts.length === 0) return { output: 'Usage: read <path> [start_line] [end_line]', success: false };

      let endLine: number | undefined;
      let startLine: number | undefined;
      let rawPath = parts.join(' ');

      // Try resolving the full args as a path first
      if (parts.length >= 2) {
        const fullCandidate = parts.join(' ');
        const resolvedFull = fuzzyResolve(fullCandidate);
        if (resolvedFull) {
          rawPath = fullCandidate;
        } else {
          // Try stripping trailing numbers as line ranges
          let pathEnd = parts.length;
          if (/^\d+$/.test(parts[parts.length - 1])) {
            endLine = parseInt(parts[parts.length - 1]);
            pathEnd--;
            if (pathEnd >= 2 && /^\d+$/.test(parts[pathEnd - 1])) {
              startLine = parseInt(parts[pathEnd - 1]);
              pathEnd--;
            }
            rawPath = parts.slice(0, pathEnd).join(' ');
          }
        }
      }
      if (!rawPath) return { output: 'Usage: read <path> [start_line] [end_line]', success: false };

      const resolved = fuzzyResolve(rawPath);
      if (!resolved) return { output: `Error: File not found: ${rawPath}`, success: false };
      const path = resolved;

      // Defense-in-depth: read safety check inside the tool
      const safety = checkReadSafety(path);
      if (!safety.allowed) {
        return { output: `Safety blocked: ${safety.reason}`, success: false };
      }

      // Check if it's an image
      const ext = path.split('.').pop()?.toLowerCase() || '';
      const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'];
      if (imageExts.includes(ext)) {
        const stats = statSync(path);
        return {
          output: `[Image: ${path}]\n  Format: ${ext.toUpperCase()}\n  Size: ${(stats.size / 1024).toFixed(1)} KB\n  Note: Image content cannot be displayed as text.`,
          success: true,
          metadata: { path, type: 'image', format: ext, size: stats.size },
        };
      }

      // Read once, check for binary, then use as text
      const buf = await readFile(path);
      if (buf.includes(0x00) && !path.endsWith('.ts') && !path.endsWith('.js')) {
        const stats = statSync(path);
        return {
          output: `[Binary file: ${path}]\n  Size: ${(stats.size / 1024).toFixed(1)} KB\n  Note: Binary content cannot be displayed as text.`,
          success: true,
          metadata: { path, type: 'binary', size: stats.size },
        };
      }

      const content = buf.toString('utf-8');
      const hash = contentHash(content);
      const lines = content.split('\n');
      const start = (startLine || 1) - 1;
      const end = Math.min(endLine || lines.length, start + MAX_LINES);
      const slice = lines.slice(start, end);
      const numbered = slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n');

      const header = `${path} [hash:${hash}] ${lines.length} lines`;
      const range = startLine ? ` (showing ${start + 1}-${end})` : '';

      return {
        output: `${header}${range}\n${numbered}`,
        success: true,
        metadata: { hash, lines: lines.length, path, start, end },
      };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};

export { contentHash, fuzzyResolve };
