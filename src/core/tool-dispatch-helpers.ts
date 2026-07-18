/**
 * Tool dispatch helpers — parallelism gating, mutation tracking.
 *
 * Pure module-level utilities for deciding when tools can run concurrently.
 */

import { FILE_MUTATING_TOOL_NAMES } from './tool-result-classification.js';

// Tools that must never run concurrently (interactive / user-facing)
const NEVER_PARALLEL_TOOLS = new Set(['clarify', 'ask_user']);

// Read-only tools that are safe to parallelize
const PARALLEL_SAFE_TOOLS = new Set([
  'read', 'grep', 'glob', 'ls', 'session_search', 'web_fetch', 'web_search',
]);

// File tools that can run concurrently when targeting independent paths
const PATH_SCOPED_TOOLS = new Set(['read', 'write', 'edit']);

// Patterns that indicate a terminal command may modify/delete files
const DESTRUCTIVE_PATTERNS = /(?:^|\s|&&|\|\||;)(?:rm\s|rmdir\s|cp\s|mv\s|sed\s+-i|truncate\s|dd\s|shred\s|git\s+(?:reset|clean|checkout)\s)/;
const REDIRECT_OVERWRITE = /[^>]>[^>]|^>[^>]/;

/**
 * Check if a terminal command looks like it modifies/deletes files.
 */
export function isDestructiveCommand(cmd: string): boolean {
  if (!cmd) return false;
  return DESTRUCTIVE_PATTERNS.test(cmd) || REDIRECT_OVERWRITE.test(cmd);
}

/**
 * Extract file paths from tool arguments for parallelism gating.
 */
export function extractPathsFromArgs(toolName: string, args: Record<string, unknown>): string[] {
  const paths: string[] = [];
  const pathKeys = ['path', 'file_path', 'workdir', 'dir'];

  for (const key of pathKeys) {
    const val = args[key];
    if (typeof val === 'string' && val.trim()) {
      paths.push(val.trim());
    }
  }

  // For exec commands, extract path-like tokens
  if (toolName === 'exec' && typeof args.command === 'string') {
    const tokens = args.command.split(/\s+/);
    for (const token of tokens) {
      if (token.startsWith('-')) continue;
      if (token.includes('/') || token.includes('.')) {
        if (!token.startsWith('http://') && !token.startsWith('https://')) {
          paths.push(token);
        }
      }
    }
  }

  return paths;
}

/**
 * Check if two paths overlap (one is a parent/sibling of the other).
 */
export function pathsOverlap(path1: string, path2: string): boolean {
  if (path1 === path2) return true;
  if (path1.startsWith(path2 + '/')) return true;
  if (path2.startsWith(path1 + '/')) return true;
  return false;
}

/**
 * Decide if a batch of tool calls can run in parallel.
 * Returns { parallel: boolean, reason?: string }
 */
export function shouldParallelizeToolBatch(
  calls: Array<{ name: string; args: Record<string, unknown> }>,
): { parallel: boolean; reason?: string } {
  if (calls.length <= 1) return { parallel: false, reason: 'single call' };

  // Check for tools that must never be parallelized
  for (const call of calls) {
    if (NEVER_PARALLEL_TOOLS.has(call.name)) {
      return { parallel: false, reason: `${call.name} must not be parallelized` };
    }
  }

  // Check if all tools are parallel-safe
  const allSafe = calls.every(c => PARALLEL_SAFE_TOOLS.has(c.name));
  if (allSafe) return { parallel: true };

  // Check for path-scoped tools with non-overlapping paths
  const pathScoped = calls.filter(c => PATH_SCOPED_TOOLS.has(c.name));
  if (pathScoped.length === calls.length) {
    const allPaths = pathScoped.map(c => extractPathsFromArgs(c.name, c.args)).flat();
    // Check for overlapping paths
    for (let i = 0; i < allPaths.length; i++) {
      for (let j = i + 1; j < allPaths.length; j++) {
        if (pathsOverlap(allPaths[i], allPaths[j])) {
          return { parallel: false, reason: 'overlapping paths' };
        }
      }
    }
    return { parallel: true };
  }

  // Mix of safe and unsafe tools — don't parallelize
  return { parallel: false, reason: 'mixed safe/unsafe tools' };
}

/**
 * Check if a tool result indicates a file mutation landed successfully.
 */
export function fileMutationResultLanded(toolName: string, result: unknown): boolean {
  return FILE_MUTATING_TOOL_NAMES.has(toolName) && typeof result === 'string' && result.length > 0;
}

/**
 * Extract error preview from a tool result.
 */
export function extractErrorPreview(result: unknown, maxLen = 200): string | null {
  if (typeof result !== 'string') return null;
  try {
    const data = JSON.parse(result);
    if (data.error) {
      const msg = String(data.error);
      return msg.length > maxLen ? msg.slice(0, maxLen) + '…' : msg;
    }
  } catch {
    // Not JSON — check for error patterns in plain text
    if (result.toLowerCase().includes('error')) {
      return result.length > maxLen ? result.slice(0, maxLen) + '…' : result;
    }
  }
  return null;
}
