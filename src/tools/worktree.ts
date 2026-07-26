/**
 * Kairo — Worktree Tools (Kairo-native rewrite)
 *
 * Git worktree isolation for parallel work.
 */

import { execSync } from 'child_process'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { ToolDefinition, ToolResult } from './types.js'

const WORKTREE_DIR = '.kairo/worktrees'

function getWorktreePath(name: string): string {
  return join(WORKTREE_DIR, name)
}

export const enterWorktreeTool: ToolDefinition = {
  name: 'enter_worktree',
  description: 'Create and enter a git worktree for isolated parallel work',
  prompt: `Create a git worktree for isolated work on a separate branch.

Usage:
- enter_worktree <name> — create a worktree with the given name
- enter_worktree <name> <branch> — create worktree on specific branch

Worktrees allow you to work on multiple branches simultaneously without stashing.`,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Worktree name' },
      branch: { type: 'string', description: 'Branch name (optional, creates new branch if not exists)' },
    },
    required: ['name'],
  },
  tier: 'exec',
  concurrencySafe: false,
  readOnly: false,
  destructive: false,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      let name: string
      let branch: string | undefined

      try {
        const parsed = JSON.parse(args)
        name = parsed.name
        branch = parsed.branch
      } catch {
        const parts = args.trim().split(/\s+/)
        name = parts[0] || ''
        branch = parts[1]
      }

      if (!name) return { output: 'Error: worktree name is required', success: false }

      const worktreePath = getWorktreePath(name)

      // Create worktrees directory
      if (!existsSync(WORKTREE_DIR)) mkdirSync(WORKTREE_DIR, { recursive: true })

      if (existsSync(worktreePath)) {
        return { output: `Worktree "${name}" already exists at ${worktreePath}`, success: false }
      }

      // Create the worktree
      const branchFlag = branch ? `-b ${branch}` : ''
      execSync(`git worktree add ${branchFlag} ${worktreePath}`, { encoding: 'utf-8' })

      return {
        output: `Entered worktree "${name}" at ${worktreePath}`,
        success: true,
        metadata: { name, path: worktreePath, branch },
      }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}

export const exitWorktreeTool: ToolDefinition = {
  name: 'exit_worktree',
  description: 'Exit and optionally remove a git worktree',
  prompt: `Exit a git worktree, keeping or removing it.

Usage:
- exit_worktree <name> — exit and remove worktree
- exit_worktree <name> keep — exit but keep worktree on disk`,
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Worktree name' },
      action: { type: 'string', description: '"keep" or "remove" (default: remove)' },
    },
    required: ['name'],
  },
  tier: 'exec',
  concurrencySafe: false,
  readOnly: false,
  destructive: true,

  execute: async (args: string): Promise<ToolResult> => {
    try {
      let name: string
      let action: 'keep' | 'remove' = 'remove'

      try {
        const parsed = JSON.parse(args)
        name = parsed.name
        action = parsed.action || 'remove'
      } catch {
        const parts = args.trim().split(/\s+/)
        name = parts[0] || ''
        if (parts[1] === 'keep') action = 'keep'
      }

      if (!name) return { output: 'Error: worktree name is required', success: false }

      const worktreePath = getWorktreePath(name)

      if (!existsSync(worktreePath)) {
        return { output: `Worktree "${name}" not found`, success: false }
      }

      if (action === 'remove') {
        execSync(`git worktree remove ${worktreePath}`, { encoding: 'utf-8' })
        return { output: `Removed worktree "${name}"`, success: true }
      } else {
        return { output: `Kept worktree "${name}" at ${worktreePath}`, success: true }
      }
    } catch (e) {
      return { output: `Error: ${(e as Error).message}`, success: false }
    }
  },
}
