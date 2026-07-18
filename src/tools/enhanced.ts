/**
 * Kairo — Enhanced Tools
 * Hash-anchored edits, bash safety, git integration, fuzzy path resolution
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, unlinkSync, renameSync } from 'fs';
import { execSync, spawnSync } from 'child_process';
import { join, dirname, basename, resolve } from 'path';
import { homedir } from 'os';
import * as crypto from 'crypto';

// ─── Hash Utilities ───────────────────────────────────────────────

function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

// ─── File Snapshot Store ──────────────────────────────────────────

interface FileSnapshot {
  path: string;
  hash: string;
  content: string;
  timestamp: number;
}

const snapshotStore = new Map<string, FileSnapshot>();

function recordSnapshot(path: string): FileSnapshot {
  const content = readFileSync(path, 'utf-8');
  const snapshot: FileSnapshot = {
    path,
    hash: contentHash(content),
    content,
    timestamp: statSync(path).mtimeMs,
  };
  snapshotStore.set(path, snapshot);
  return snapshot;
}

// ─── Fuzzy Path Resolution ────────────────────────────────────────

function fuzzyResolve(path: string): string | null {
  if (existsSync(path)) return path;

  // Try common extensions
  for (const ext of ['.ts', '.js', '.tsx', '.jsx', '.py', '.md', '.json', '.yml', '.yaml']) {
    if (existsSync(path + ext)) return path + ext;
  }

  // Try in common directories
  for (const dir of ['src', 'lib', 'app', 'pages', 'components', 'utils']) {
    const candidate = join(dir, path);
    if (existsSync(candidate)) return candidate;
    for (const ext of ['.ts', '.js', '.tsx', '.jsx']) {
      if (existsSync(candidate + ext)) return candidate + ext;
    }
  }

  return null;
}

// ─── Bash Safety ──────────────────────────────────────────────────

interface BashClassification {
  safe: boolean;
  readOnly: boolean;
  destructive: boolean;
  reason: string;
}

const SAFE_READ = ['ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc', 'pwd', 'echo', 'which', 'whoami', 'date', 'env', 'printenv', 'tree', 'file', 'stat', 'du', 'df', 'ps', 'top', 'free', 'uname', 'hostname', 'id', 'groups', 'git log', 'git status', 'git diff', 'git show', 'git branch'];
const DANGEROUS = ['rm -rf /', 'rm -r /', 'mkfs', 'dd if=', ':(){', 'fork bomb', 'chmod -R 777 /', 'chown -R'];
const WRITE = ['rm', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown', 'truncate', 'shred', 'git add', 'git commit', 'git push', 'git reset', 'npm install', 'npm i', 'yarn', 'pnpm'];

function classifyBash(cmd: string): BashClassification {
  const t = cmd.trim();

  for (const d of DANGEROUS) {
    if (t.includes(d)) return { safe: false, readOnly: false, destructive: true, reason: `Dangerous: ${d}` };
  }

  for (const w of WRITE) {
    if (t.startsWith(w) || t.includes(` ${w} `)) {
      return { safe: true, readOnly: false, destructive: false, reason: `Write: ${w}` };
    }
  }

  if (t.includes('>') || t.includes('>>')) {
    return { safe: true, readOnly: false, destructive: false, reason: 'Output redirect' };
  }

  for (const r of SAFE_READ) {
    if (t.startsWith(r)) return { safe: true, readOnly: true, destructive: false, reason: `Read: ${r}` };
  }

  return { safe: true, readOnly: false, destructive: false, reason: 'Unknown' };
}

// ─── Tool Interface ───────────────────────────────────────────────

export interface ToolResult {
  output: string;
  success: boolean;
  metadata?: Record<string, unknown>;
}

export interface Tool {
  name: string;
  description: string;
  isConcurrencySafe: (args: string) => boolean;
  isReadOnly: (args: string) => boolean;
  isDestructive: (args: string) => boolean;
  checkPermissions: (args: string) => { allowed: boolean; reason?: string };
  execute: (args: string) => Promise<ToolResult>;
}

function buildTool(def: Partial<Tool> & Pick<Tool, 'name' | 'execute'>): Tool {
  return {
    description: '',
    isConcurrencySafe: () => false,
    isReadOnly: () => false,
    isDestructive: () => false,
    checkPermissions: () => ({ allowed: true }),
    ...def,
  };
}

// ─── Tool Definitions ─────────────────────────────────────────────

export const TOOLS: Record<string, Tool> = {
  read: buildTool({
    name: 'read',
    description: 'Read a file with line numbers and content hash. Usage: !read <path> [start] [end]',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    execute: async (args: string) => {
      try {
        const parts = args.split(/\s+/);
        let path = parts[0];
        const startLine = parts[1] ? parseInt(parts[1]) : undefined;
        const endLine = parts[2] ? parseInt(parts[2]) : undefined;

        if (!path) return { output: 'Usage: !read <path> [start_line] [end_line]', success: false };

        // Fuzzy resolve
        const resolved = fuzzyResolve(path);
        if (!resolved) return { output: `Error: File not found: ${path}`, success: false };
        path = resolved;

        const content = readFileSync(path, 'utf-8');
        const snapshot = recordSnapshot(path);
        const lines = content.split('\n');
        const start = (startLine || 1) - 1;
        const end = endLine || lines.length;
        const slice = lines.slice(start, end);
        const numbered = slice.map((l, i) => `${start + i + 1}|${l}`).join('\n');

        const header = `${path} [hash:${snapshot.hash}] ${lines.length} lines`;
        const range = startLine ? ` (showing ${start + 1}-${end})` : '';
        return {
          output: `${header}${range}\n${numbered}`,
          success: true,
          metadata: { hash: snapshot.hash, lines: lines.length, path }
        };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  write: buildTool({
    name: 'write',
    description: 'Write file. Hash-anchored: !write path#hash\\ncontent (verifies file unchanged)',
    isReadOnly: () => false,
    execute: async (args: string) => {
      try {
        const nl = args.indexOf('\n');
        if (nl === -1) return { output: 'Usage: !write <path[#hash]>\\n<content>', success: false };

        const firstLine = args.slice(0, nl).trim();
        const content = args.slice(nl + 1);
        let path: string;
        let expectedHash: string | null = null;

        const hashSep = firstLine.indexOf('#');
        if (hashSep > 0) {
          path = firstLine.slice(0, hashSep);
          expectedHash = firstLine.slice(hashSep + 1);
        } else {
          path = firstLine;
        }

        // Verify hash
        if (expectedHash && existsSync(path)) {
          const existing = readFileSync(path, 'utf-8');
          const actual = contentHash(existing);
          if (actual !== expectedHash) {
            return { output: `Hash mismatch. Expected ${expectedHash}, got ${actual}. File changed since read.`, success: false };
          }
        }

        const dir = dirname(path);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(path, content, 'utf-8');
        const newHash = contentHash(content);
        recordSnapshot(path);

        return { output: `Wrote ${path} [hash:${newHash}]`, success: true, metadata: { hash: newHash, path } };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  edit: buildTool({
    name: 'edit',
    description: 'Find and replace. Usage: !edit path\\nold_string\\nnew_string',
    isReadOnly: () => false,
    execute: async (args: string) => {
      try {
        const parts = args.split('\n');
        if (parts.length < 3) return { output: 'Usage: !edit <path>\\n<old_string>\\n<new_string>', success: false };

        let path = parts[0].trim();
        const resolved = fuzzyResolve(path);
        if (!resolved) return { output: `Error: File not found: ${path}`, success: false };
        path = resolved;

        const oldStr = parts[1];
        const newStr = parts.slice(2).join('\n');
        const content = readFileSync(path, 'utf-8');

        if (!content.includes(oldStr)) {
          return { output: `Error: String not found in ${path}`, success: false };
        }

        const newContent = content.replace(oldStr, newStr);
        writeFileSync(path, newContent, 'utf-8');
        recordSnapshot(path);

        return { output: `Edited ${path}`, success: true, metadata: { path } };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  exec: buildTool({
    name: 'exec',
    description: 'Execute shell command. Safety classified (read/write/destructive)',
    isConcurrencySafe: (cmd) => classifyBash(cmd).readOnly,
    isReadOnly: (cmd) => classifyBash(cmd).readOnly,
    isDestructive: (cmd) => classifyBash(cmd).destructive,
    checkPermissions: (cmd) => {
      const c = classifyBash(cmd);
      if (c.destructive) return { allowed: false, reason: `Blocked: ${c.reason}` };
      return { allowed: true };
    },
    execute: async (cmd: string) => {
      try {
        const result = spawnSync(cmd, { shell: true, encoding: 'utf-8', timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
        const output = (result.stdout || '') + (result.stderr || '');
        const exitCode = result.status ?? 0;
        return {
          output: exitCode === 0 ? output.trim() : `Exit ${exitCode}:\n${output.trim()}`,
          success: exitCode === 0,
          metadata: { exitCode, classification: classifyBash(cmd).reason }
        };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  ls: buildTool({
    name: 'ls',
    description: 'List directory contents',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    execute: async (path: string) => {
      try {
        const target = path || '.';
        const entries = readdirSync(target, { withFileTypes: true });
        const list = entries.map(e => {
          const icon = e.isDirectory() ? '📁' : '📄';
          let size = '';
          try {
            if (e.isFile()) {
              const s = statSync(join(target, e.name));
              size = ` ${formatSize(s.size)}`;
            }
          } catch {}
          return `${icon} ${e.name}${size}`;
        }).join('\n');
        return { output: list || '(empty)', success: true };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  git: buildTool({
    name: 'git',
    description: 'Git operations (status, log, diff, add, commit)',
    isConcurrencySafe: (args) => args.startsWith('status') || args.startsWith('log') || args.startsWith('diff'),
    isReadOnly: (args) => args.startsWith('status') || args.startsWith('log') || args.startsWith('diff') || args.startsWith('show'),
    execute: async (args: string) => {
      try {
        const result = spawnSync(`git ${args}`, { shell: true, encoding: 'utf-8', timeout: 15000 });
        return { output: (result.stdout || result.stderr || '').trim(), success: result.status === 0 };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  grep: buildTool({
    name: 'grep',
    description: 'Search for pattern in files. Usage: !grep <pattern> [path]',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    execute: async (args: string) => {
      try {
        const parts = args.split(/\s+/);
        const pattern = parts[0];
        const path = parts[1] || '.';
        if (!pattern) return { output: 'Usage: !grep <pattern> [path]', success: false };

        const cmd = `grep -rn "${pattern}" ${path} --include="*.ts" --include="*.js" --include="*.py" --include="*.md" --include="*.json" --include="*.yml" 2>/dev/null | head -50`;
        const result = spawnSync(cmd, { shell: true, encoding: 'utf-8', timeout: 10000 });
        return { output: result.stdout?.trim() || 'No matches', success: true };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  glob: buildTool({
    name: 'glob',
    description: 'Find files by pattern. Usage: !glob <pattern>',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    execute: async (pattern: string) => {
      try {
        if (!pattern) return { output: 'Usage: !glob <pattern>', success: false };
        const cmd = `find . -path ./node_modules -prune -o -path ./.git -prune -o -name "${pattern}" -print 2>/dev/null | head -100`;
        const result = spawnSync(cmd, { shell: true, encoding: 'utf-8', timeout: 10000 });
        return { output: result.stdout?.trim() || 'No matches', success: true };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  ps: buildTool({
    name: 'ps',
    description: 'List running processes',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    execute: async () => {
      try {
        const cmd = process.platform === 'win32' ? 'tasklist' : 'ps aux | head -20';
        const result = spawnSync(cmd, { shell: true, encoding: 'utf-8', timeout: 10000 });
        return { output: result.stdout || '', success: result.status === 0 };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  sysinfo: buildTool({
    name: 'sysinfo',
    description: 'Get system information',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    execute: async () => {
      try {
        const os = require('os');
        const info = {
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          hostname: os.hostname(),
          cpus: os.cpus().length,
          memory: `${Math.round(os.totalmem() / 1024 / 1024)}MB`,
          uptime: `${Math.round(os.uptime() / 60)}min`,
          cwd: process.cwd(),
        };
        return { output: JSON.stringify(info, null, 2), success: true };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  mkdir: buildTool({
    name: 'mkdir',
    description: 'Create directory (recursive)',
    isReadOnly: () => false,
    execute: async (path: string) => {
      try {
        mkdirSync(path, { recursive: true });
        return { output: `Created ${path}`, success: true };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  rm: buildTool({
    name: 'rm',
    description: 'Remove file',
    isReadOnly: () => false,
    isDestructive: () => true,
    checkPermissions: (path) => {
      if (path === '/' || path === '/*') return { allowed: false, reason: 'Cannot delete root' };
      return { allowed: true };
    },
    execute: async (path: string) => {
      try {
        unlinkSync(path);
        return { output: `Removed ${path}`, success: true };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  mv: buildTool({
    name: 'mv',
    description: 'Move/rename file. Usage: !mv <src>\\n<dst>',
    isReadOnly: () => false,
    execute: async (args: string) => {
      try {
        const [src, dst] = args.split('\n').map(s => s.trim());
        if (!src || !dst) return { output: 'Usage: !mv <source>\\n<destination>', success: false };
        renameSync(src, dst);
        return { output: `Moved ${src} → ${dst}`, success: true };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),

  search: buildTool({
    name: 'search',
    description: 'Search for pattern in files (alias for grep)',
    isConcurrencySafe: () => true,
    isReadOnly: () => true,
    execute: async (args: string) => {
      return TOOLS.grep.execute(args);
    },
  }),

  memory: buildTool({
    name: 'memory',
    description: 'Save/search memories. Usage: !memory save <text> or !memory search <query>',
    isConcurrencySafe: () => true,
    isReadOnly: (args) => args.startsWith('search'),
    execute: async (args: string) => {
      try {
        const parts = args.split(/\s+/);
        const action = parts[0];
        const text = parts.slice(1).join(' ');

        if (action === 'save' && text) {
          const memDir = join(homedir(), '.kairo', 'memory');
          if (!existsSync(memDir)) mkdirSync(memDir, { recursive: true });
          const id = Date.now().toString(36);
          const file = join(memDir, `${id}.md`);
          writeFileSync(file, `---\ntimestamp: ${new Date().toISOString()}\n---\n${text}`);
          return { output: `Saved memory: ${id}`, success: true };
        }

        if (action === 'search' && text) {
          const memDir = join(homedir(), '.kairo', 'memory');
          if (!existsSync(memDir)) return { output: 'No memories found.', success: true };
          const files = readdirSync(memDir).filter(f => f.endsWith('.md'));
          const matches: string[] = [];
          for (const f of files) {
            const content = readFileSync(join(memDir, f), 'utf-8');
            if (content.toLowerCase().includes(text.toLowerCase())) {
              matches.push(content.slice(0, 200));
            }
          }
          return { output: matches.length ? matches.join('\n---\n') : 'No matches.', success: true };
        }

        return { output: 'Usage: !memory save <text> or !memory search <query>', success: false };
      } catch (e) { return { output: `Error: ${(e as Error).message}`, success: false }; }
    },
  }),
};

// ─── Tool Execution ───────────────────────────────────────────────

export async function executeTool(name: string, args: string): Promise<ToolResult> {
  const tool = TOOLS[name];
  if (!tool) return { output: `Unknown tool: ${name}. Available: ${Object.keys(TOOLS).join(', ')}`, success: false };

  const permission = tool.checkPermissions(args);
  if (!permission.allowed) {
    return { output: `Permission denied: ${permission.reason}`, success: false };
  }

  return tool.execute(args);
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export { extractToolCalls } from './types.js';
