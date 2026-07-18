/**
 * Kairo — Path Validation (Shim)
 * Simplified: provides the interface that ported files need
 */

import type { PermissionDecisionReason } from '../../core/permissions/types.js'
import { homedir } from 'os'
import { join } from 'path'

export type FileOperationType = 'read' | 'write' | 'execute' | 'create'

/**
 * Expand tilde (~) in paths
 */
export function expandTilde(path: string): string {
  if (path === '~') {
    return homedir()
  }
  if (path.startsWith('~/')) {
    return join(homedir(), path.slice(2))
  }
  return path
}

/**
 * Format a list of directories for display
 */
export function formatDirectoryList(dirs: string[]): string {
  return dirs.map(d => `  ${d}`).join('\n')
}

/**
 * Check if a path is a dangerous removal target (e.g., /, ~, ..)
 */
export function isDangerousRemovalPath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalized || normalized === '/' || normalized === '~') return true
  if (normalized === '..' || normalized.endsWith('/..')) return true
  return false
}

/**
 * Validate a path for a specific operation type.
 * Signature matches OpenClaude: (path, cwd, toolPermissionContext, operationType)
 */
export function validatePath(
  path: string,
  _cwd: string,
  _toolPermissionContext?: unknown,
  _operation?: FileOperationType,
): {
  allowed: boolean
  resolvedPath?: string
  decisionReason?: PermissionDecisionReason
  valid?: boolean
  reason?: string
} {
  if (!path) {
    return { allowed: false, reason: 'Empty path', valid: false }
  }
  // Basic validation — can be extended
  return { allowed: true, resolvedPath: path, valid: true }
}
