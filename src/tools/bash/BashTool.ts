/**
 * Kairo — BashTool Type Definitions
 *
 * Type definitions and constants for the bash tool.
 */

import { z } from 'zod/v4'
import type { ToolPermissionContext, PermissionResult } from '../../core/permissions/types.js'

// ============================================================================
// BashTool Constants
// ============================================================================

export const BASH_TOOL_NAME = 'Bash'

// ============================================================================
// BashTool Input Schema (zod)
// ============================================================================

export const bashToolInputSchema = z.object({
  command: z.string().describe('The bash command to execute'),
  description: z.string().optional().describe('Clear description of what this command does'),
  timeout: z.number().optional().describe('Timeout in milliseconds (default: 120000)'),
  run_in_background: z.boolean().optional().describe('Run command in background'),
  dangerouslyDisableSandbox: z.boolean().optional().describe('Disable sandboxing'),
})

export type BashToolInput = z.infer<typeof bashToolInputSchema>

// ============================================================================
// BashTool Output Types
// ============================================================================

export type BashToolOutput = {
  stdout: string
  stderr: string
  exitCode: number
  interrupted?: boolean
}

// ============================================================================
// BashTool Object (matches OpenClaude's BashTool class interface)
// ============================================================================

export const BashTool = {
  name: BASH_TOOL_NAME,
  inputSchema: bashToolInputSchema,
  description: 'Execute bash commands',
  isReadOnly(input: BashToolInput): boolean {
    const READ_ONLY = ['cat', 'ls', 'find', 'head', 'tail', 'echo', 'pwd', 'wc', 'sort', 'uniq', 'diff', 'grep', 'git']
    // Split compound commands on &&, ||, ;, | and check every part
    const parts = input.command.trim().split(/\s*(&&|\|\||;|\|)\s*/).filter(p => p && !/^(&&|\|\||;|\|)$/.test(p))
    return parts.every(part => {
      const cmd = part.split(/\s+/)[0] || ''
      return READ_ONLY.includes(cmd)
    })
  },
}

// ============================================================================
// BashTool Permission Helpers
// ============================================================================

export function getBashToolPermissionContext(): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  }
}
