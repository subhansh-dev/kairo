/**
 * File system abstractions — async filesystem, local implementation, file tree, git status.
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// ─── Async Filesystem ──────────────────────────────────────

export interface AsyncFileSystem {
  root(): string;
  exists(p: string): Promise<boolean>;
  readFile(p: string): Promise<Uint8Array>;
  tryReadFile(p: string): Promise<Uint8Array | null>;
  writeFile(p: string, data: Uint8Array): Promise<void>;
  deleteFile(p: string): Promise<void>;
}

export function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// ─── Async FS Wrapper ──────────────────────────────────────

export class AsyncFsWrapper {
  private inner: AsyncFileSystem;

  constructor(fs: AsyncFileSystem) {
    this.inner = fs;
  }

  root(): string { return this.inner.root(); }

  async exists(p: string): Promise<boolean> {
    return this.inner.exists(path.resolve(this.inner.root(), p));
  }

  async readFile(p: string): Promise<Uint8Array> {
    return this.inner.readFile(path.resolve(this.inner.root(), p));
  }

  async readToString(p: string): Promise<string> {
    const bytes = await this.readFile(p);
    return bytesToString(bytes);
  }

  async tryReadFile(p: string): Promise<Uint8Array | null> {
    return this.inner.tryReadFile(path.resolve(this.inner.root(), p));
  }

  async tryReadToString(p: string): Promise<string | null> {
    const bytes = await this.tryReadFile(p);
    return bytes ? bytesToString(bytes) : null;
  }

  async writeFile(p: string, data: Uint8Array): Promise<void> {
    await this.inner.writeFile(path.resolve(this.inner.root(), p), data);
  }

  async deleteFile(p: string): Promise<void> {
    await this.inner.deleteFile(path.resolve(this.inner.root(), p));
  }
}

// ─── Local Filesystem ──────────────────────────────────────

export class LocalFs implements AsyncFileSystem {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  root(): string { return this.rootDir; }

  async exists(p: string): Promise<boolean> {
    return fs.existsSync(p);
  }

  async readFile(p: string): Promise<Uint8Array> {
    return new Uint8Array(fs.readFileSync(p));
  }

  async tryReadFile(p: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(fs.readFileSync(p));
    } catch {
      return null;
    }
  }

  async writeFile(p: string, data: Uint8Array): Promise<void> {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, data);
  }

  async deleteFile(p: string): Promise<void> {
    fs.unlinkSync(p);
  }
}

// ─── File Tree ─────────────────────────────────────────────

export interface ListContentsLimits {
  maxCharacters: number;
  maxDepth: number;
  maxDirsVisited: number;
}

const DEFAULT_LIMITS: ListContentsLimits = {
  maxCharacters: 10_000,
  maxDepth: 12,
  maxDirsVisited: 2000,
};

interface DirContents {
  files: string[];
  dirs: string[];
}

function collectAllContents(
  root: string,
  maxDepth: number,
  maxDirs: number,
): Map<string, DirContents> {
  const map = new Map<string, DirContents>();
  map.set(root, { files: [], dirs: [] });

  function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    if (map.size > maxDirs) return;

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') && depth > 0) continue;
        if (entry.name === 'node_modules' || entry.name === 'target') continue;

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const parent = map.get(dir) ?? { files: [], dirs: [] };
          parent.dirs.push(entry.name + '/');
          map.set(dir, parent);
          map.set(fullPath, { files: [], dirs: [] });
          walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const parent = map.get(dir) ?? { files: [], dirs: [] };
          parent.files.push(entry.name);
          map.set(dir, parent);
        }
      }
    } catch {
      // Skip unreadable dirs
    }
  }

  walk(root, 0);
  return map;
}

export async function listContents(
  rootPath: string,
  limits: ListContentsLimits = DEFAULT_LIMITS,
): Promise<string> {
  const maxChars = limits.maxCharacters;
  const pathHead = rootPath.replace(/\\/g, '/') + '/';
  const contents = collectAllContents(rootPath, limits.maxDepth, limits.maxDirsVisited);

  const lines: string[] = [pathHead];
  let charCount = pathHead.length;

  function renderDir(dirPath: string, depth: number) {
    const dir = contents.get(dirPath);
    if (!dir) return;

    const indent = '  '.repeat(depth + 1);
    const allEntries = [...dir.dirs, ...dir.files].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

    for (const entry of allEntries) {
      if (charCount > maxChars) return;
      const line = `${indent}- ${entry}`;
      lines.push(line);
      charCount += line.length + 1;

      if (entry.endsWith('/')) {
        renderDir(path.join(dirPath, entry.slice(0, -1)), depth + 1);
      }
    }
  }

  renderDir(rootPath, 0);
  return lines.join('\n');
}

// ─── Git Status ────────────────────────────────────────────

export async function gitStatus(workingDirectory: string): Promise<string> {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: workingDirectory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    let output = '';
    if (branch === 'HEAD') {
      const hash = execSync('git rev-parse --short HEAD', {
        cwd: workingDirectory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      output = `HEAD detached at ${hash}\n`;
    } else {
      output = `On branch ${branch}\n`;
    }

    try {
      const counts = execSync('git rev-list --count --left-right @{upstream}...HEAD', {
        cwd: workingDirectory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      const [behind, ahead] = counts.split(/\s+/).map(Number);
      if (ahead > 0 && behind > 0) {
        output += `Your branch and upstream have diverged (${ahead} ahead, ${behind} behind).\n`;
      } else if (ahead > 0) {
        output += `Your branch is ahead by ${ahead} commit${ahead > 1 ? 's' : ''}.\n`;
      } else if (behind > 0) {
        output += `Your branch is behind by ${behind} commit${behind > 1 ? 's' : ''}.\n`;
      }
    } catch {
      // No upstream
    }

    const staged = execSync('git diff --cached --name-status HEAD', {
      cwd: workingDirectory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!staged) {
      output += '\nnothing to commit, working tree clean';
    } else {
      output += '\nChanges to be committed:\n';
      for (const line of staged.split('\n').slice(0, 50)) {
        const [status, ...parts] = line.split('\t');
        const filePath = parts.join('\t');
        const label = status?.startsWith('A') ? 'new file'
          : status?.startsWith('M') ? 'modified'
          : status?.startsWith('D') ? 'deleted'
          : status?.startsWith('R') ? 'renamed'
          : status ?? '?';
        output += `\t${label}: ${filePath}\n`;
      }
    }

    return output;
  } catch {
    return 'Not a git repository';
  }
}

export async function gitStatusShort(workingDirectory: string): Promise<string> {
  try {
    return execSync('git status --short --branch', {
      cwd: workingDirectory, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return '';
  }
}

// ─── Fuzzy Match Result ────────────────────────────────────

export interface FuzzyMatchResult {
  path: string;
  score: number;
  indices: number[];
  isDir: boolean;
}
