/**
 * Workspace management — discovery, config, and handle.
 */

import * as fs from 'fs';
import * as path from 'path';
import { createWorkspaceIdentity, createWorkspaceMetadata, type WorkspaceConfig, type WorkspaceIdentity } from './types.js';

export interface WorkspaceHandle {
  config: WorkspaceConfig;
  rootPath: string;
}

const WORKSPACE_MARKERS = [
  'package.json',
  'tsconfig.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  '.git',
];

/**
 * Discover workspace root by walking up from a starting path.
 */
export function discoverWorkspaceRoot(startPath: string): string | null {
  let current = startPath;

  for (let i = 0; i < 50; i++) {
    for (const marker of WORKSPACE_MARKERS) {
      if (fs.existsSync(path.join(current, marker))) {
        return current;
      }
    }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

/**
 * Load workspace config from a root path.
 */
export function loadWorkspaceConfig(rootPath: string): WorkspaceConfig {
  const name = path.basename(rootPath);

  return {
    identity: createWorkspaceIdentity(name, rootPath),
    metadata: createWorkspaceMetadata(),
    permissions: ['read', 'write', 'execute'],
  };
}

/**
 * Create a workspace handle.
 */
export function createWorkspaceHandle(rootPath: string): WorkspaceHandle {
  return {
    config: loadWorkspaceConfig(rootPath),
    rootPath,
  };
}

/**
 * Check if a path is within the workspace.
 */
export function isPathInWorkspace(filePath: string, workspaceRoot: string): boolean {
  const normalized = path.resolve(filePath);
  const root = path.resolve(workspaceRoot);
  return normalized.startsWith(root + path.sep) || normalized === root;
}
