/**
 * Path resolution — workspace-relative and home-relative path utilities.
 */

import * as path from 'path';
import * as os from 'os';

/**
 * Resolve a workspace-relative path.
 */
export function resolveWorkspacePath(
  workspaceRoot: string,
  relativePath: string,
): string {
  return path.resolve(workspaceRoot, relativePath);
}

/**
 * Get the user's home directory.
 */
export function getHomeDir(): string {
  return os.homedir();
}

/**
 * Get the config directory for the application.
 */
export function getConfigDir(appName: string = 'kairo'): string {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.APPDATA || path.join(getHomeDir(), 'AppData', 'Roaming'), appName);
    case 'darwin':
      return path.join(getHomeDir(), 'Library', 'Application Support', appName);
    default:
      return path.join(process.env.XDG_CONFIG_HOME || path.join(getHomeDir(), '.config'), appName);
  }
}

/**
 * Get the data directory for the application.
 */
export function getDataDir(appName: string = 'kairo'): string {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.LOCALAPPDATA || path.join(getHomeDir(), 'AppData', 'Local'), appName);
    case 'darwin':
      return path.join(getHomeDir(), 'Library', 'Application Support', appName);
    default:
      return path.join(process.env.XDG_DATA_HOME || path.join(getHomeDir(), '.local', 'share'), appName);
  }
}

/**
 * Get the cache directory for the application.
 */
export function getCacheDir(appName: string = 'kairo'): string {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.LOCALAPPDATA || path.join(getHomeDir(), 'AppData', 'Local'), appName, 'Cache');
    case 'darwin':
      return path.join(getHomeDir(), 'Library', 'Caches', appName);
    default:
      return path.join(process.env.XDG_CACHE_HOME || path.join(getHomeDir(), '.cache'), appName);
  }
}

/**
 * Normalize a file path for cross-platform use.
 */
export function normalizePath(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Make a path relative to the workspace root.
 */
export function makeRelative(filePath: string, workspaceRoot: string): string {
  return path.relative(workspaceRoot, filePath).split(path.sep).join('/');
}
