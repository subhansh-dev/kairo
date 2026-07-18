/**
 * Kairo — Permissions Module
 *
 * Central permission system for tool execution safety.
 */

// Types
export {
  PERMISSION_MODES,
  type PermissionMode,
  type PermissionBehavior,
  type PermissionRuleSource,
  type PermissionRuleValue,
  type PermissionRule,
  type PermissionDecisionReason,
  type PermissionAllowDecision,
  type PermissionAskDecision,
  type PermissionDenyDecision,
  type PermissionDecision,
  type PermissionResult,
  type PermissionUpdate,
  type PermissionUpdateDestination,
  type ToolPermissionRulesBySource,
  type ToolPermissionContext,
  getRuleBehaviorDescription,
  isDangerousPermissionMode,
  isDefaultMode,
  permissionModeTitle,
  permissionModeFromString,
  createEmptyToolPermissionContext,
} from './types.js'

// Dangerous patterns
export {
  CROSS_PLATFORM_CODE_EXEC,
  DANGEROUS_BASH_PATTERNS,
} from './dangerousPatterns.js'

// Denial tracking
export {
  type DenialTrackingState,
  DENIAL_LIMITS,
  createDenialTrackingState,
  recordDenial,
  recordSuccess,
  shouldFallbackToPrompting,
} from './denialTracking.js'

// Shell rule matching
export {
  type ShellPermissionRule,
  permissionRuleExtractPrefix,
  hasWildcards,
  matchWildcardPattern,
  parsePermissionRule,
  suggestionForExactCommand,
  suggestionForPrefix,
} from './shellRuleMatching.js'

// Permission rule parser
export {
  normalizeLegacyToolName,
  getLegacyToolNames,
  escapeRuleContent,
  unescapeRuleContent,
  permissionRuleValueFromString,
  permissionRuleValueToString,
} from './permissionRuleParser.js'

// Bash classifier (stub)
export {
  PROMPT_PREFIX,
  type ClassifierResult,
  type ClassifierBehavior,
  isClassifierPermissionsEnabled,
  classifyBashCommand,
} from './bashClassifier.js'

// Classifier shared
export {
  extractToolUseBlock,
  parseClassifierResponse,
} from './classifierShared.js'

// Path validation
export {
  type FileOperationType,
  type PathCheckResult,
  type ResolvedPathCheckResult,
  formatDirectoryList,
  getGlobBaseDirectory,
  expandTilde,
  isDangerousRemovalPath,
  isPathAllowed,
  validatePath,
} from './pathValidation.js'
