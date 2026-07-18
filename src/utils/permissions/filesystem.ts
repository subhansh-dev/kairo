/**
 * Kairo — Filesystem Permissions (Shim)
 * Simplified: provides the interface that ported files need
 */

import type { ToolPermissionContext, PermissionRuleSource } from '../../core/permissions/types.js'
import { resolve } from 'path'

/**
 * Get all working directories from the permission context
 */
export function allWorkingDirectories(
  context: ToolPermissionContext,
): string[] {
  const dirs: string[] = [process.cwd()]
  for (const [, entry] of context.additionalWorkingDirectories) {
    dirs.push(entry.path)
  }
  return dirs
}

/**
 * Check if a path is within any of the allowed working directories
 */
export function isPathInWorkingDirectory(
  filePath: string,
  workingDirectories: string[],
): boolean {
  const resolved = resolve(filePath)
  return workingDirectories.some(dir => resolved.startsWith(resolve(dir)))
}
