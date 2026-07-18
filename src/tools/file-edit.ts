import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { ToolDefinition, ToolResult } from './types.js';
import { contentHash, resolvePath } from '../utils/hash.js';
import { checkWriteSafety } from '../core/file-safety.js';

export const fileEditTool: ToolDefinition = {
  name: 'edit',
  description: 'Find and replace in a file. Usage: edit path\\nold_string\\nnew_string',
  prompt: `Performs exact string replacement in a file.

Usage:
edit <path>
<old_string>
<new_string>

Rules:
- old_string must be unique in the file (exactly one match) unless --replaceAll is used
- old_string must match exactly including whitespace and indentation
- Use --replaceAll after the path to replace all occurrences:
  edit path --replaceAll
  old_string
  new_string
- Use read first to get the exact content you want to replace`,
  tier: 'write',
  concurrencySafe: false,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const parts = args.split('\n');
      if (parts.length < 3) {
        return { output: 'Usage: edit <path> [--replaceAll]\\n<old_string>\\n<new_string>', success: false };
      }

      const firstLine = parts[0].trim();
      const oldStr = parts[1];
      const newStr = parts.slice(2).join('\n');

      let path: string;
      let replaceAll = false;

      const firstParts = firstLine.split(/\s+/);
      replaceAll = firstParts.includes('--replaceAll');
      // Extract path: first token that isn't a flag
      const pathToken = firstParts.find(p => !p.startsWith('--')) || firstParts[0];
      path = resolvePath(pathToken);

      // Defense-in-depth: safety check inside the tool
      const safety = checkWriteSafety(path);
      if (!safety.allowed) {
        return { output: `Safety blocked: ${safety.reason}`, success: false };
      }

      if (!existsSync(path)) {
        return { output: `Error: File not found: ${path}`, success: false };
      }

      const content = await readFile(path, 'utf-8');
      const oldHash = contentHash(content);

      // Hash-anchored write: if caller provides expected hash, verify before writing
      const hashIdx = firstParts.findIndex(p => p.startsWith('hash:'));
      if (hashIdx > 0) {
        const expectedHash = firstParts[hashIdx].slice(5);
        if (expectedHash !== oldHash) {
          return {
            output: `Error: File has changed since last read (expected hash:${expectedHash}, got hash:${oldHash}). Re-read the file and try again.`,
            success: false,
          };
        }
      }

      if (!content.includes(oldStr)) {
        return { output: `Error: String not found in ${path}. Make sure the old_string matches exactly.`, success: false };
      }

      if (replaceAll) {
        const newContent = content.split(oldStr).join(newStr);
        const newHash = contentHash(newContent);

        const count = content.split(oldStr).length - 1;
        await writeFile(path, newContent, 'utf-8');
        return {
          output: `Edited ${path} [hash:${newHash}]\nReplaced ${count} occurrence(s)`,
          success: true,
          metadata: { path, hash: newHash, replacements: count, mode: 'replaceAll' },
        };
      }

      const count = content.split(oldStr).length - 1;
      if (count > 1) {
        return {
          output: `Error: String found ${count} times in ${path}. The old_string must be unique. Provide more context to make it unique, or use --replaceAll.`,
          success: false,
        };
      }

      const newContent = content.replace(oldStr, newStr);
      const newHash = contentHash(newContent);

      await writeFile(path, newContent, 'utf-8');

      return {
        output: `Edited ${path} [hash:${newHash}]`,
        success: true,
        metadata: { path, hash: newHash, replacements: 1, mode: 'single' },
      };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};
