/**
 * Kairo — Path Validation
 * Stripped: Tool.js, platform, fsOperations, sandbox, filesystem deps
 * Simplified: standalone path validation for kairo's permission system
 */

import { homedir } from 'os'
import { dirname, isAbsolute, resolve } from 'path'
import type { ToolPermissionContext, PermissionDecisionReason } from './types.js'

const MAX_DIRS_TO_LIST = 5
const GLOB_PATTERN_REGEX = /[*?[\]{}]/
const WINDOWS_DRIVE_ROOT_REGEX = /^[A-Za-z]:\/?$/
const WINDOWS_DRIVE_CHILD_REGEX = /^[A-Za-z]:\/[^/]+$/

export type FileOperationType = 'read' | 'write' | 'create'

export type PathCheckResult = {
  allowed: boolean
  decisionReason?: PermissionDecisionReason
}

export type ResolvedPathCheckResult = PathCheckResult & {
  resolvedPath: string
}

export function formatDirectoryList(directories: string[]): string {
  const dirCount = directories.length
  if (dirCount <= MAX_DIRS_TO_LIST) {
    return directories.map(dir => `'${dir}'`).join(', ')
  }
  const firstDirs = directories.slice(0, MAX_DIRS_TO_LIST).map(dir => `'${dir}'`).join(', ')
  return `${firstDirs}, and ${dirCount - MAX_DIRS_TO_LIST} more`
}

export function getGlobBaseDirectory(path: string): string {
  const globMatch = path.match(GLOB_PATTERN_REGEX)
  if (!globMatch || globMatch.index === undefined) return path
  const beforeGlob = path.substring(0, globMatch.index)
  const lastSepIndex = process.platform === 'win32'
    ? Math.max(beforeGlob.lastIndexOf('/'), beforeGlob.lastIndexOf('\\'))
    : beforeGlob.lastIndexOf('/')
  if (lastSepIndex === -1) return '.'
  return beforeGlob.substring(0, lastSepIndex) || '/'
}

export function expandTilde(path: string): string {
  if (path === '~' || path.startsWith('~/') || (process.platform === 'win32' && path.startsWith('~\\'))) {
    return homedir() + path.slice(1)
  }
  return path
}

export function isDangerousRemovalPath(resolvedPath: string): boolean {
  const forwardSlashed = resolvedPath.replace(/[\\/]+/g, '/')
  if (forwardSlashed === '*' || forwardSlashed.endsWith('/*')) return true
  const normalizedPath = forwardSlashed === '/' ? forwardSlashed : forwardSlashed.replace(/\/$/, '')
  if (normalizedPath === '/') return true
  if (WINDOWS_DRIVE_ROOT_REGEX.test(normalizedPath)) return true
  const normalizedHome = homedir().replace(/[\\/]+/g, '/')
  if (normalizedPath === normalizedHome) return true
  const parentDir = dirname(normalizedPath)
  if (parentDir === '/') return true
  if (WINDOWS_DRIVE_CHILD_REGEX.test(normalizedPath)) return true
  return false
}

/** Simplified path-in-working-dir check for kairo */
function pathInWorkingPath(resolvedPath: string, workingPath: string): boolean {
  const normalizedPath = resolvedPath.replace(/[\\/]+/g, '/').toLowerCase()
  const normalizedWorking = workingPath.replace(/[\\/]+/g, '/').toLowerCase()
  return normalizedPath === normalizedWorking || normalizedPath.startsWith(normalizedWorking + '/')
}

/** Get allowed working directories from context */
function getAllowedDirectories(context: ToolPermissionContext): string[] {
  const dirs: string[] = [process.cwd()]
  for (const [, dir] of context.additionalWorkingDirectories) {
    dirs.push(dir.path)
  }
  return dirs
}

export function isPathAllowed(
  resolvedPath: string,
  context: ToolPermissionContext,
  operationType: FileOperationType,
): PathCheckResult {
  // Check if path is in allowed working directory
  const allowedDirs = getAllowedDirectories(context)
  const isInWorkingDir = allowedDirs.some(dir => pathInWorkingPath(resolvedPath, dir))

  if (isInWorkingDir) {
    return { allowed: true }
  }

  return { allowed: false }
}

export function validatePath(
  path: string,
  cwd: string,
  toolPermissionContext: ToolPermissionContext,
  operationType: FileOperationType,
): ResolvedPathCheckResult {
  const cleanPath = expandTilde(path.replace(/^['"]|['"]$/g, ''))

  // Block shell expansion syntax
  if (cleanPath.includes('$') || cleanPath.includes('%') || cleanPath.startsWith('=')) {
    return {
      allowed: false,
      resolvedPath: cleanPath,
      decisionReason: { type: 'other', reason: 'Shell expansion syntax in paths requires manual approval' },
    }
  }

  // Block tilde variants (~user, ~+, ~-)
  if (cleanPath.startsWith('~')) {
    return {
      allowed: false,
      resolvedPath: cleanPath,
      decisionReason: { type: 'other', reason: 'Tilde expansion variants require manual approval' },
    }
  }

  // Block glob patterns in write operations
  if (GLOB_PATTERN_REGEX.test(cleanPath) && (operationType === 'write' || operationType === 'create')) {
    return {
      allowed: false,
      resolvedPath: cleanPath,
      decisionReason: { type: 'other', reason: 'Glob patterns not allowed in write operations' },
    }
  }

  const absolutePath = isAbsolute(cleanPath) ? cleanPath : resolve(cwd, cleanPath)
  const resolvedPath = absolutePath

  const result = isPathAllowed(resolvedPath, toolPermissionContext, operationType)
  return { allowed: result.allowed, resolvedPath, decisionReason: result.decisionReason }
}
