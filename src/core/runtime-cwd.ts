/**
 * Runtime working directory resolution.
 *
 * Single source of truth for the agent working directory.
 * Resolves from session override > env var > process.cwd().
 */

import { existsSync, statSync } from 'fs';
import { resolve, join } from 'path';

// Session-scoped working directory override
let sessionCwd: string | null = null;

/**
 * Set the working directory for the current session.
 */
export function setSessionCwd(cwd: string | null): void {
  sessionCwd = cwd?.trim() || null;
}

/**
 * Clear the session working directory override.
 */
export function clearSessionCwd(): void {
  sessionCwd = null;
}

/**
 * Get the session working directory override.
 */
export function getSessionCwd(): string | null {
  return sessionCwd;
}

/**
 * Resolve the agent's working directory.
 * Priority: session override > KAIRO_CWD env > process.cwd()
 */
export function resolveAgentCwd(): string {
  // 1. Session override
  if (sessionCwd) {
    const p = resolve(sessionCwd);
    if (existsSync(p) && statSync(p).isDirectory()) return p;
  }

  // 2. Environment variable
  const envCwd = process.env.KAIRO_CWD?.trim();
  if (envCwd) {
    const p = resolve(envCwd);
    if (existsSync(p) && statSync(p).isDirectory()) return p;
  }

  // 3. Process cwd
  try {
    return process.cwd();
  } catch {
    return process.env.HOME || process.env.USERPROFILE || '/';
  }
}

/**
 * Resolve the context discovery working directory.
 * Returns null if no configured cwd (falls back to launch dir).
 */
export function resolveContextCwd(): string | null {
  if (sessionCwd) {
    const p = resolve(sessionCwd);
    if (existsSync(p) && statSync(p).isDirectory()) return p;
    return null;
  }

  const envCwd = process.env.KAIRO_CWD?.trim();
  if (envCwd) {
    const p = resolve(envCwd);
    if (existsSync(p) && statSync(p).isDirectory()) return p;
    return null;
  }

  return null;
}

/**
 * Check if a path is a valid working directory.
 */
export function isValidWorkingDir(path: string): boolean {
  try {
    const p = resolve(path);
    return existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Get the project root by walking up from a path looking for markers.
 */
export function findProjectRoot(startPath: string): string | null {
  const markers = ['.git', 'package.json', 'tsconfig.json', 'Cargo.toml', 'go.mod', 'pyproject.toml'];
  let current = resolve(startPath);
  const root = resolve('/');

  while (current !== root) {
    for (const marker of markers) {
      if (existsSync(join(current, marker))) return current;
    }
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }

  return null;
}
