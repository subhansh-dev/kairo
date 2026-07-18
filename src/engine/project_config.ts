/**
 * Project config-file discovery — locating repo-local .mcp.json and .grok/config.toml.
 *
 */

import * as fs from 'fs/promises';
import * as path from 'path';

export const MCP_JSON_FILENAME = '.mcp.json';

/**
 * Find git root for a given cwd.
 */
export async function findGitRoot(cwd: string): Promise<string | null> {
  let current = cwd;
  const maxDepth = 50;

  for (let i = 0; i < maxDepth; i++) {
    try {
      await fs.access(path.join(current, '.git'));
      return current;
    } catch {
      // Not found, go up
    }

    const parent = path.dirname(current);
    if (parent === current) break; // Root reached
    current = parent;
  }

  return null;
}

/**
 * Get directory chain from cwd to git root (cwd-first order).
 */
export async function getRepoDirChain(cwd: string): Promise<string[]> {
  const dirs: string[] = [cwd];
  let current = cwd;
  const maxDepth = 50;

  for (let i = 0; i < maxDepth; i++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
    dirs.push(current);
  }

  return dirs;
}

/**
 * Candidate .mcp.json paths from repo root to cwd (repo-root-first).
 */
export function mcpJsonCandidatePaths(cwd: string, chainDirs: string[]): string[] {
  // Reverse so repo root comes first
  return [...chainDirs].reverse().map(dir => path.join(dir, MCP_JSON_FILENAME));
}

/**
 * Find existing .mcp.json files from cwd up to git root (repo-root-first).
 */
export async function findMcpJsonFiles(cwd: string): Promise<string[]> {
  const chainDirs = await getRepoDirChain(cwd);
  const candidates = mcpJsonCandidatePaths(cwd, chainDirs);

  const existing: string[] = [];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        existing.push(candidate);
      }
    } catch { /* not found */ }
  }

  return existing;
}

/**
 * Find all .grok/config.toml files from cwd upward to git repo root.
 * Returns paths ordered from repo root (lowest priority) to cwd (highest).
 */
export async function findProjectConfigs(cwd: string): Promise<string[]> {
  const chainDirs = await getRepoDirChain(cwd);
  return findProjectConfigsIn(chainDirs);
}

/**
 * findProjectConfigs over a precomputed dir chain (repo-root-first).
 */
export async function findProjectConfigsIn(chainDirs: string[]): Promise<string[]> {
  const userHome = process.env.GROK_HOME || path.join(require('os').homedir(), '.grok');
  const userConfig = path.join(userHome, 'config.toml');

  // Reverse so repo root comes first (lowest priority)
  const configs: string[] = [];
  for (const dir of [...chainDirs].reverse()) {
    const configPath = path.join(dir, '.grok', 'config.toml');
    try {
      const stat = await fs.stat(configPath);
      if (stat.isFile() && path.resolve(configPath) !== path.resolve(userConfig)) {
        configs.push(configPath);
      }
    } catch { /* not found */ }
  }

  return configs;
}
