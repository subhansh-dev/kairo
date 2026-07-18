/**
 * Kairo — List Directory Tool
 * 
 */

import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { ToolDefinition, ToolResult } from './types.js';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export const lsTool: ToolDefinition = {
  name: 'ls',
  description: 'List directory contents. Usage: ls [path]',
  prompt: `List directory contents with file sizes and types.

Usage:
- ls — list current directory
- ls <path> — list specified directory
- ls -a — show hidden files (dotfiles)`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const showHidden = args.includes('-a');
      const path = args.replace('-a', '').trim() || '.';

      const entries = readdirSync(path, { withFileTypes: true });
      const lines: string[] = [];

      for (const entry of entries) {
        if (!showHidden && entry.name.startsWith('.')) continue;

        const fullPath = join(path, entry.name);
        let size = '';
        let icon: string;

        try {
          if (entry.isDirectory()) {
            icon = '📁';
            const count = readdirSync(fullPath).length;
            size = `${count} items`;
          } else {
            icon = '📄';
            const stat = statSync(fullPath);
            size = formatSize(stat.size);
          }
        } catch {
          icon = '❓';
          size = '?';
        }

        lines.push(`${icon} ${entry.name}  ${size}`);
      }

      return {
        output: lines.join('\n') || '(empty directory)',
        success: true,
        metadata: { path, entries: lines.length },
      };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};
