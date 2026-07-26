import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, resolve, isAbsolute } from 'path';
import { homedir } from 'os';
import type { ToolDefinition, ToolResult } from './types.js';

/** Expand ~ to home directory */
function expandPath(p: string): string {
  if (p.startsWith('~/') || p.startsWith('~\\')) return join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache', 'target', '__pycache__', '.venv', 'venv', '.kairo']);

interface WalkOptions {
  maxDepth: number;
  currentDepth: number;
  includePattern?: RegExp;
  excludePattern?: RegExp;
}

function walkDir(dir: string, options: WalkOptions): string[] {
  if (options.currentDepth > options.maxDepth) return [];
  const results: string[] = [];

  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      // Skip symlinks to prevent infinite loops
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          results.push(...walkDir(fullPath, { ...options, currentDepth: options.currentDepth + 1 }));
        }
      } else if (entry.isFile()) {
        if (options.includePattern && !options.includePattern.test(entry.name)) continue;
        if (options.excludePattern && options.excludePattern.test(entry.name)) continue;
        results.push(fullPath);
        // Cap at 5000 files to prevent OOM
        if (results.length >= 5000) return results;
      }
    }
  } catch {}

  return results;
}

function searchInFile(filePath: string, pattern: RegExp): Array<{ line: number; content: string }> {
  const matches: Array<{ line: number; content: string }> = [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        matches.push({ line: i + 1, content: lines[i].trim() });
      }
    }
  } catch {}
  return matches;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${regexStr}$`);
}

export const grepTool: ToolDefinition = {
  name: 'grep',
  description: 'Search for pattern in files using regex. Usage: grep <pattern> [path] [glob]',
  prompt: `Search for a regex pattern in file contents. Returns matching lines with file paths and line numbers.
Native Node.js implementation — no external dependencies.

Usage:
- grep <pattern> — search in current directory
- grep <pattern> <path> — search in specific path
- grep <pattern> <path> <glob> — search with file filter (e.g., "*.ts")

Pattern is treated as a case-insensitive regex.`,
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regex pattern to search for' },
      path: { type: 'string', description: 'File or directory to search in' },
    },
    required: ['pattern'],
  },
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const parts = args.split(/\s+/);
      const pattern = parts[0];
      const searchPath = parts[1] || '.';
      const glob = parts[2];

      if (!pattern) return { output: 'Usage: grep <pattern> [path] [glob]', success: false };

      let regex: RegExp;
      try {
        regex = new RegExp(pattern, 'i');
      } catch {
        return { output: `Error: Invalid regex pattern: ${pattern}`, success: false };
      }

      const resolvedPath = resolve(expandPath(searchPath));
      let files: string[];

      const stats = statSync(resolvedPath);
      if (stats.isFile()) {
        files = [resolvedPath];
      } else {
        const includePattern = glob ? globToRegex(glob) : undefined;
        files = walkDir(resolvedPath, { maxDepth: 20, currentDepth: 0, includePattern });
      }

      const results: Array<{ file: string; line: number; content: string }> = [];
      for (const file of files) {
        const matches = searchInFile(file, regex);
        for (const match of matches) {
          const relPath = relative(process.cwd(), file);
          results.push({ file: relPath, line: match.line, content: match.content });
        }

        if (results.length >= 100) break;
      }

      if (results.length === 0) {
        return { output: 'No matches found.', success: true, metadata: { pattern, path: searchPath, matches: 0 } };
      }

      const output = results
        .map(r => `${r.file}:${r.line}: ${r.content}`)
        .slice(0, 100)
        .join('\n');

      return {
        output,
        success: true,
        metadata: { pattern, path: searchPath, matches: results.length, shown: Math.min(results.length, 100) },
      };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};

export const globTool: ToolDefinition = {
  name: 'glob',
  description: 'Find files by glob pattern. Usage: glob <pattern>',
  prompt: `Find files matching a glob pattern. Returns file paths sorted by modification time.
Native Node.js implementation — no external dependencies.

Usage:
- glob *.ts — find all TypeScript files
- glob **/*.tsx — find all TSX files recursively
- glob src/**/*.ts — find TS files in src/`,
  tier: 'read',
  concurrencySafe: true,
  readOnly: true,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      const pattern = args.trim();
      if (!pattern) return { output: 'Usage: glob <pattern>', success: false };

      const isDeep = pattern.startsWith('**/');
      const namePattern = pattern.replace(/^\*\*\//, '');
      const regex = globToRegex(namePattern);

      const maxDepth = isDeep ? 20 : 0;
      const files = walkDir(process.cwd(), { maxDepth, currentDepth: 0 });

      const matched = files
        .filter(f => regex.test(f.split(/[/\\]/).pop() || ''))
        .sort((a, b) => {
          try {
            return statSync(b).mtimeMs - statSync(a).mtimeMs;
          } catch { return 0; }
        })
        .slice(0, 100)
        .map(f => relative(process.cwd(), f));

      const output = matched.length > 0 ? matched.join('\n') : 'No matches found.';

      return {
        output,
        success: true,
        metadata: { pattern, files: matched.length },
      };
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false };
    }
  },
};
