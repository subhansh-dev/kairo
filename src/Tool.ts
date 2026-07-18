/**
 * Kairo — Tool Types (Stub)
 */

import type { ToolPermissionContext } from './core/permissions/types.js'
export type { ToolPermissionContext, PermissionResult, PermissionDecisionReason } from './core/permissions/types.js'

export type ToolUseContext = {
  options: {
    mainLoopModel: string
    tools: readonly unknown[]
    verbose: boolean
    isNonInteractiveSession: boolean
  }
  abortController: AbortController
  messages: unknown[]
  getAppState?: () => {
    permissionMode?: string
    toolPermissionContext?: ToolPermissionContext
  } | undefined
}
