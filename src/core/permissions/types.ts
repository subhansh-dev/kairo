/**
 * Kairo — Permission Types
 * Stripped: bun:bundle, @anthropic-ai/sdk, React content blocks
 */

// ============================================================================
// Permission Modes
// ============================================================================

export const PERMISSION_MODES = [
  'default',
  'plan',
  'acceptEdits',
  'bypassPermissions',
  'fullAccess',
  'auto',
] as const

export type PermissionMode = (typeof PERMISSION_MODES)[number]

// ============================================================================
// Permission Behaviors
// ============================================================================

export type PermissionBehavior = 'allow' | 'deny' | 'ask'

// ============================================================================
// Permission Rules
// ============================================================================

export type PermissionRuleSource =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'cliArg'
  | 'command'
  | 'session'

export type PermissionRuleValue = {
  toolName: string
  ruleContent?: string
}

export type PermissionRule = {
  source: PermissionRuleSource
  ruleBehavior: PermissionBehavior
  ruleValue: PermissionRuleValue
}

// ============================================================================
// Permission Decisions & Results
// ============================================================================

export type PermissionDecisionReason =
  | { type: 'rule'; rule: PermissionRule }
  | { type: 'mode'; mode: PermissionMode }
  | { type: 'subcommandResults'; reasons: Map<string, PermissionResult> }
  | { type: 'hook'; hookName: string; reason?: string }
  | { type: 'classifier'; classifier: string; reason: string }
  | { type: 'safetyCheck'; reason: string; classifierApprovable: boolean }
  | { type: 'other'; reason: string }

export type PermissionAllowDecision = {
  behavior: 'allow'
  updatedInput?: Record<string, unknown>
  decisionReason?: PermissionDecisionReason
  acceptFeedback?: string
}

export type PermissionAskDecision = {
  behavior: 'ask'
  message: string
  updatedInput?: Record<string, unknown>
  decisionReason?: PermissionDecisionReason
  suggestions?: PermissionUpdate[]
  blockedPath?: string
  isBashSecurityCheckForMisparsing?: boolean
}

export type PermissionDenyDecision = {
  behavior: 'deny'
  message: string
  decisionReason: PermissionDecisionReason
}

export type PermissionDecision =
  | PermissionAllowDecision
  | PermissionAskDecision
  | PermissionDenyDecision

export type PermissionResult =
  | PermissionDecision
  | {
      behavior: 'passthrough'
      message: string
      decisionReason?: PermissionDecisionReason
      suggestions?: PermissionUpdate[]
      blockedPath?: string
    }

// ============================================================================
// Permission Updates
// ============================================================================

export type PermissionUpdateDestination =
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'session'

export type PermissionUpdate =
  | {
      type: 'addRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
    }
  | {
      type: 'replaceRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
    }
  | {
      type: 'removeRules'
      destination: PermissionUpdateDestination
      rules: PermissionRuleValue[]
      behavior: PermissionBehavior
    }
  | {
      type: 'setMode'
      destination: PermissionUpdateDestination
      mode: PermissionMode
    }
  | {
      type: 'addDirectories'
      destination: PermissionUpdateDestination
      directories: string[]
      source?: PermissionRuleSource
    }

// ============================================================================
// Tool Permission Context
// ============================================================================

export type ToolPermissionRulesBySource = {
  [T in PermissionRuleSource]?: string[]
}

export type ToolPermissionContext = {
  readonly mode: PermissionMode
  readonly additionalWorkingDirectories: ReadonlyMap<string, { path: string; source: PermissionRuleSource }>
  readonly alwaysAllowRules: ToolPermissionRulesBySource
  readonly alwaysDenyRules: ToolPermissionRulesBySource
  readonly alwaysAskRules: ToolPermissionRulesBySource
  readonly isBypassPermissionsModeAvailable: boolean
  readonly strippedDangerousRules?: ToolPermissionRulesBySource
  readonly shouldAvoidPermissionPrompts?: boolean
}

// ============================================================================
// Helper Functions
// ============================================================================

export function getRuleBehaviorDescription(result: PermissionResult): string {
  switch (result.behavior) {
    case 'allow': return 'allowed'
    case 'deny': return 'denied'
    case 'ask': return 'asked for confirmation for'
    case 'passthrough': return 'passed through'
  }
}

export function isDangerousPermissionMode(mode: PermissionMode): boolean {
  return mode === 'bypassPermissions' || mode === 'fullAccess'
}

export function isDefaultMode(mode: PermissionMode): boolean {
  return mode === 'default'
}

export function permissionModeTitle(mode: PermissionMode): string {
  const titles: Record<PermissionMode, string> = {
    default: 'Default',
    plan: 'Plan Mode',
    acceptEdits: 'Accept Edits',
    bypassPermissions: 'Bypass Permissions',
    fullAccess: 'Full Access',
    auto: 'Auto',
  }
  return titles[mode] ?? mode
}

export function permissionModeFromString(str: string): PermissionMode | null {
  if ((PERMISSION_MODES as readonly string[]).includes(str)) {
    return str as PermissionMode
  }
  return null
}

export function createEmptyToolPermissionContext(): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  }
}
