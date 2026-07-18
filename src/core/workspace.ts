/**
 * Workspace — workspace management utilities.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve, dirname } from 'path';

export interface WorkspaceConfig {
  root: string;
  name: string;
  type?: string;
  gitRepo?: boolean;
}

/**
 * Detect workspace type from files present.
 */
export function detectWorkspaceType(root: string): string {
  const markers: Record<string, string> = {
    'package.json': 'node',
    'Cargo.toml': 'rust',
    'go.mod': 'go',
    'pyproject.toml': 'python',
    'setup.py': 'python',
    'requirements.txt': 'python',
    'Gemfile': 'ruby',
    'pom.xml': 'java',
    'build.gradle': 'java',
    'CMakeLists.txt': 'cpp',
    'Makefile': 'make',
    'docker-compose.yml': 'docker',
    'Dockerfile': 'docker',
  };

  for (const [file, type] of Object.entries(markers)) {
    if (existsSync(join(root, file))) return type;
  }
  return 'unknown';
}

/**
 * Get workspace name from directory.
 */
export function getWorkspaceName(root: string): string {
  const parts = root.split('/');
  return parts[parts.length - 1] || 'workspace';
}

/**
 * Check if a directory is a git repository.
 */
export function isGitRepo(root: string): boolean {
  return existsSync(join(root, '.git'));
}

/**
 * Get workspace info.
 */
export function getWorkspaceInfo(root: string): WorkspaceConfig {
  return {
    root: resolve(root),
    name: getWorkspaceName(root),
    type: detectWorkspaceType(root),
    gitRepo: isGitRepo(root),
  };
}

/**
 * Create a workspace file if it doesn't exist.
 */
export function ensureWorkspaceFile(root: string, relativePath: string, defaultContent: string): void {
  const fullPath = join(root, relativePath);
  if (!existsSync(fullPath)) {
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, defaultContent, 'utf-8');
  }
}
