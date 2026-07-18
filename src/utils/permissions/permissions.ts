/**
 * Permission utilities
 * Simplified implementations for kairo
 */

import type {
  PermissionRuleValue,
  PermissionRule,
  ToolPermissionContext,
} from '../../core/permissions/types.js'

/**
 * Create a permission request message for the user.
 * Accepts either a string or a PermissionDecisionReason object.
 */
export function createPermissionRequestMessage(
  toolName: string,
  ruleContent?: string | { type?: string; reason?: string; mode?: string },
): string {
  if (!ruleContent) {
    return `Permission required: ${toolName}`
  }
  if (typeof ruleContent === 'string') {
    return `Permission required: ${toolName} (${ruleContent})`
  }
  // Object form — extract the reason/mode string
  const detail = ruleContent.reason || ruleContent.mode || 'unknown reason'
  return `Permission required: ${toolName} (${detail})`
}

/**
 * Get rules by contents for a specific tool.
 * Returns a Map of rule content -> PermissionRule.
 * Accepts toolName as string or object with .name property.
 */
export function getRuleByContentsForTool(
  _context: ToolPermissionContext,
  toolName: string | { name: string },
  _content: string,
): Map<string, PermissionRule> {
  return new Map()
}

/**
 * Get a rule by its contents for a specific tool name
 */
export function getRuleByContentsForToolName(
  _toolName: string,
  _content: string,
): PermissionRule | undefined {
  return undefined
}
