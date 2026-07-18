/**
 * Kairo — Git Utilities (Simplified)
 * Stripped: lodash-es, memoize, fsOperations, gitFilesystem, diagLogs, etc.
 * Provides essential git functions using child_process.execSync
 */

import { createHash } from 'crypto'
import { execSync } from 'child_process'
import { readFileSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join, resolve, sep } from 'path'
import { getCwd } from './cwd.js'
import { getPlatform } from './platform.js'

const GIT_ROOT_NOT_FOUND = Symbol('git-root-not-found')

// Simple memoization cache
const gitRootCache = new Map<string, string | typeof GIT_ROOT_NOT_FOUND>()

function findGitRootImpl(startPath: string): string | typeof GIT_ROOT_NOT_FOUND {
  if (gitRootCache.has(startPath)) return gitRootCache.get(startPath)!

  let current = resolve(startPath)
  const root = current.substring(0, current.indexOf(sep) + 1) || sep

  while (current !== root) {
    try {
      const gitPath = join(current, '.git')
      const stat = statSync(gitPath)
      if (stat.isDirectory() || stat.isFile()) {
        gitRootCache.set(startPath, current)
        return current
      }
    } catch {
      // .git doesn't exist at this level
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  // Check root directory
  try {
    const gitPath = join(root, '.git')
    const stat = statSync(gitPath)
    if (stat.isDirectory() || stat.isFile()) {
      gitRootCache.set(startPath, root)
      return root
    }
  } catch {
    // no .git at root
  }

  gitRootCache.set(startPath, GIT_ROOT_NOT_FOUND)
  return GIT_ROOT_NOT_FOUND
}

export function findGitRoot(startPath: string): string | null {
  const result = findGitRootImpl(startPath)
  return result === GIT_ROOT_NOT_FOUND ? null : result
}

export function findCanonicalGitRoot(startPath: string): string | null {
  return findGitRoot(startPath)
}

export function gitExe(): string {
  return 'git'
}

export async function getIsGit(): Promise<boolean> {
  return findGitRoot(getCwd()) !== null
}

export async function isAtGitRoot(): Promise<boolean> {
  const cwd = getCwd()
  const gitRoot = findGitRoot(cwd)
  return gitRoot !== null && cwd === gitRoot
}

export async function getHead(): Promise<string> {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf-8', cwd: getCwd() }).trim()
  } catch {
    return ''
  }
}

export async function getBranch(): Promise<string> {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8', cwd: getCwd() }).trim()
  } catch {
    return ''
  }
}

export async function getDefaultBranch(): Promise<string> {
  try {
    return execSync('git rev-parse --abbrev-ref origin/HEAD', { encoding: 'utf-8', cwd: getCwd() }).trim().replace('origin/', '')
  } catch {
    return 'main'
  }
}

export async function getRemoteUrl(): Promise<string | null> {
  try {
    return execSync('git remote get-url origin', { encoding: 'utf-8', cwd: getCwd() }).trim()
  } catch {
    return null
  }
}

export async function getIsClean(): Promise<boolean> {
  try {
    const output = execSync('git status --porcelain', { encoding: 'utf-8', cwd: getCwd() }).trim()
    return output.length === 0
  } catch {
    return false
  }
}

export async function getChangedFiles(): Promise<string[]> {
  try {
    const output = execSync('git status --porcelain', { encoding: 'utf-8', cwd: getCwd() })
    return output.trim().split('\n')
      .map(line => line.trim().split(' ', 2)[1]?.trim())
      .filter((line): line is string => typeof line === 'string')
  } catch {
    return []
  }
}

export type GitFileStatus = {
  tracked: string[]
  untracked: string[]
}

export async function getFileStatus(): Promise<GitFileStatus> {
  try {
    const output = execSync('git status --porcelain', { encoding: 'utf-8', cwd: getCwd() })
    const tracked: string[] = []
    const untracked: string[] = []

    output.trim().split('\n').filter(line => line.length > 0).forEach(line => {
      const status = line.substring(0, 2)
      const filename = line.substring(2).trim()
      if (status === '??') {
        untracked.push(filename)
      } else if (filename) {
        tracked.push(filename)
      }
    })

    return { tracked, untracked }
  } catch {
    return { tracked: [], untracked: [] }
  }
}

export function normalizeGitRemoteUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return null

  const sshMatch = trimmed.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
  if (sshMatch && sshMatch[1] && sshMatch[2]) {
    return `${sshMatch[1]}/${sshMatch[2]}`.toLowerCase()
  }

  const urlMatch = trimmed.match(/^(?:https?|ssh):\/\/(?:[^@]+@)?([^/]+)\/(.+?)(?:\.git)?$/)
  if (urlMatch && urlMatch[1] && urlMatch[2]) {
    return `${urlMatch[1]}/${urlMatch[2]}`.toLowerCase()
  }

  return null
}

export async function getRepoRemoteHash(): Promise<string | null> {
  const remoteUrl = await getRemoteUrl()
  if (!remoteUrl) return null
  const normalized = normalizeGitRemoteUrl(remoteUrl)
  if (!normalized) return null
  const hash = createHash('sha256').update(normalized).digest('hex')
  return hash.substring(0, 16)
}

export type GitRepoState = {
  commitHash: string
  branchName: string
  remoteUrl: string | null
  isHeadOnRemote: boolean
  isClean: boolean
  worktreeCount: number
}

export async function getGitState(): Promise<GitRepoState | null> {
  try {
    const [commitHash, branchName, remoteUrl, isClean] = await Promise.all([
      getHead(),
      getBranch(),
      getRemoteUrl(),
      getIsClean(),
    ])

    return {
      commitHash,
      branchName,
      remoteUrl,
      isHeadOnRemote: false,
      isClean,
      worktreeCount: 1,
    }
  } catch {
    return null
  }
}

/**
 * Checks if the current working directory appears to be a bare git repository
 * or has been manipulated to look like one (sandbox escape attack vector).
 */
export function isCurrentDirectoryBareGitRepo(): boolean {
  const cwd = getCwd()
  const gitPath = join(cwd, '.git')

  try {
    const stats = statSync(gitPath)
    if (stats.isFile()) {
      // worktree/submodule
      return false
    }
    if (stats.isDirectory()) {
      const gitHeadPath = join(gitPath, 'HEAD')
      try {
        if (statSync(gitHeadPath).isFile()) {
          return false
        }
      } catch {
        // .git exists but no HEAD — fall through
      }
    }
  } catch {
    // no .git — fall through to bare-repo indicator check
  }

  // Check bare git repo indicators
  try {
    if (statSync(join(cwd, 'HEAD')).isFile()) return true
  } catch { /* no HEAD */ }
  try {
    if (statSync(join(cwd, 'objects')).isDirectory()) return true
  } catch { /* no objects/ */ }
  try {
    if (statSync(join(cwd, 'refs')).isDirectory()) return true
  } catch { /* no refs/ */ }

  return false
}
