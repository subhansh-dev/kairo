/**
 * Progressive subdirectory hint discovery.
 *
 * As the agent navigates into subdirectories via tool calls, this module
 * discovers and loads project context files (AGENTS.md, CLAUDE.md, .cursorrules)
 * from those directories. Discovered hints are appended to tool results.
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve, extname, relative } from 'path';

// Context files to look for in subdirectories
const HINT_FILENAMES = [
  'AGENTS.md', 'agents.md',
  'CLAUDE.md', 'claude.md',
  '.cursorrules',
  '.kairo', // kairo-specific context directory
];

// Maximum chars per hint file to prevent context bloat
const MAX_HINT_CHARS = 8_000;

// Tool argument keys that typically contain file paths
const PATH_ARG_KEYS = ['path', 'file_path', 'workdir', 'dir'];

// How many parent directories to walk up when looking for hints
const MAX_ANCESTOR_WALK = 5;

export class SubdirectoryHintTracker {
  private workingDir: string;
  private loadedDirs: Set<string>;

  constructor(workingDir?: string) {
    this.workingDir = resolve(workingDir || process.cwd());
    this.loadedDirs = new Set([this.workingDir]);
  }

  /**
   * Check tool call arguments for new directories and load hint files.
   * Returns formatted hint text to append to the tool result, or null.
   */
  checkToolCall(toolName: string, toolArgs: Record<string, unknown>): string | null {
    const dirs = this.extractDirectories(toolName, toolArgs);
    if (dirs.length === 0) return null;

    const allHints: string[] = [];
    for (const d of dirs) {
      const hints = this.loadHintsForDirectory(d);
      if (hints) allHints.push(hints);
    }

    if (allHints.length === 0) return null;
    return '\n\n' + allHints.join('\n\n');
  }

  /**
   * Extract directory paths from tool call arguments.
   */
  private extractDirectories(toolName: string, args: Record<string, unknown>): string[] {
    const candidates = new Set<string>();

    // Direct path arguments
    for (const key of PATH_ARG_KEYS) {
      const val = args[key];
      if (typeof val === 'string' && val.trim()) {
        this.addPathCandidate(val, candidates);
      }
    }

    // Shell commands — extract path-like tokens
    if (toolName === 'exec') {
      const cmd = args.command || args.cmd;
      if (typeof cmd === 'string') {
        this.extractPathsFromCommand(cmd, candidates);
      }
    }

    return [...candidates];
  }

  /**
   * Resolve a raw path and add its directory + ancestors to candidates.
   */
  private addPathCandidate(rawPath: string, candidates: Set<string>): void {
    try {
      let p = resolve(this.workingDir, rawPath);
      // Use parent if it's a file path
      if (extname(p) || (existsSync(p) && statSync(p).isFile())) {
        const parts = p.split('/');
        parts.pop();
        p = parts.join('/') || '/';
      }
      // Walk up ancestors
      for (let i = 0; i < MAX_ANCESTOR_WALK; i++) {
        if (this.loadedDirs.has(p)) break;
        if (this.isValidSubdir(p)) candidates.add(p);
        const parent = p.split('/').slice(0, -1).join('/') || '/';
        if (parent === p) break;
        p = parent;
      }
    } catch {
      // ignore resolution errors
    }
  }

  /**
   * Extract path-like tokens from a shell command string.
   */
  private extractPathsFromCommand(cmd: string, candidates: Set<string>): void {
    const tokens = cmd.split(/\s+/);
    for (const token of tokens) {
      if (token.startsWith('-')) continue;
      if (!token.includes('/') && !token.includes('.')) continue;
      if (token.startsWith('http://') || token.startsWith('https://') || token.startsWith('git@')) continue;
      this.addPathCandidate(token, candidates);
    }
  }

  /**
   * Check if path is a valid directory to scan for hints.
   * Only allow subdirectories within the working directory tree.
   */
  private isValidSubdir(path: string): boolean {
    try {
      if (!existsSync(path) || !statSync(path).isDirectory()) return false;
      if (this.loadedDirs.has(path)) return false;
      const rel = relative(this.workingDir, path);
      return !rel.startsWith('..') && !rel.startsWith('/');
    } catch {
      return false;
    }
  }

  /**
   * Load hint files from a directory. Returns formatted text or null.
   */
  private loadHintsForDirectory(directory: string): string | null {
    this.loadedDirs.add(directory);
    const hints: string[] = [];

    for (const filename of HINT_FILENAMES) {
      const filePath = join(directory, filename);
      try {
        if (!existsSync(filePath)) continue;
        const stat = statSync(filePath);
        if (!stat.isFile()) continue;
        const content = readFileSync(filePath, 'utf-8').slice(0, MAX_HINT_CHARS);
        if (content.trim()) {
          hints.push(`[${filename} from ${directory}]\n${content}`);
        }
      } catch {
        // ignore read errors
      }
    }

    return hints.length > 0 ? hints.join('\n\n') : null;
  }

  /**
   * Reset tracker state (for testing).
   */
  reset(): void {
    this.loadedDirs = new Set([this.workingDir]);
  }

  /**
   * Get the set of already-loaded directories.
   */
  getLoadedDirs(): Set<string> {
    return new Set(this.loadedDirs);
  }
}
