/**
 * Kairo — File Write Tool
 * Hash-anchored writes with conflict detection
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import type { ToolDefinition, ToolResult } from './types.js';
import { checkWriteSafety } from '../core/file-safety.js';
import { contentHash, resolvePath } from '../utils/hash.js';

export const fileWriteTool: ToolDefinition = {
  name: 'write',
  description: 'Write file with hash-anchored conflict detection. Usage: write path#hash\\ncontent',
  prompt: `Write content to a file. Supports hash-anchored writes to prevent conflicts.

Usage:
- write <path> — create/overwrite file (no hash check)
- write <path>#<hash> — write with conflict detection

Hash-anchored writes verify the file hasn't changed since last read.
If the hash doesn't match, the write is rejected with an error.

The content starts after the first newline in the arguments.`,
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write' },
      content: { type: 'string', description: 'Full content to write to the file' },
    },
    required: ['path', 'content'],
  },
  tier: 'write',
  concurrencySafe: false,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const nl = args.indexOf('\n');
      if (nl === -1) return { output: 'Usage: write <path[#hash]>\n<content>', success: false };

      const firstLine = args.slice(0, nl).trim();
      const content = args.slice(nl + 1);
      let path: string;
      let expectedHash: string | null = null;

      const hashSep = firstLine.indexOf('#');
      if (hashSep > 0) {
        path = resolvePath(firstLine.slice(0, hashSep));
        expectedHash = firstLine.slice(hashSep + 1);
      } else {
        path = resolvePath(firstLine);
      }

      // Defense-in-depth: safety check inside the tool (engine also checks)
      const safety = checkWriteSafety(path, content);
      if (!safety.allowed) {
        return { output: `Safety blocked: ${safety.reason}`, success: false };
      }

      // Verify hash if provided
      if (expectedHash && existsSync(path)) {
        const existing = await readFile(path, 'utf-8');
        const actual = contentHash(existing);
        if (actual !== expectedHash) {
          return {
            output: `Hash mismatch! Expected ${expectedHash}, got ${actual}.\nFile has been modified since last read. Please re-read the file and try again.`,
            success: false,
          };
        }
      }

      // Create directory if needed
      const dir = dirname(path);
      if (!existsSync(dir)) await mkdir(dir, { recursive: true });

      await writeFile(path, content, 'utf-8');
      const newHash = contentHash(content);

      return {
        output: `Wrote ${path} [hash:${newHash}]`,
        success: true,
        metadata: { hash: newHash, path, bytes: content.length },
      };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};
