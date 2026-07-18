/**
 * Kairo — Main exports
 * Programmatic API for Kairo
 */

export { agentLoop, chat, type EngineEvent, type EngineOptions } from './core/engine.js';
export { getRouteSync as getRoute, classifySync as classify, TaskType, type ModelRoute } from './core/router.js';
export { getRegistry, ProviderRegistry } from './providers/registry.js';
export { EnhancedProvider } from './providers/enhanced.js';
export { getDialect, getDialectForProvider } from './providers/dialects/index.js';
export { CredentialPool, getCredentialPool } from './providers/credential-pool.js';
export { toolRegistry, extractToolCalls } from './tools/index.js';
export { getToolset, getToolsetTools, listToolsets } from './tools/toolsets.js';
export { runAgent, runWorkflow, listAgents, getAgent, listWorkflows } from './agents/orchestrator.js';
export { SkillLoader } from './skills/loader.js';
export { HookManager } from './hooks/manager.js';
export { SessionManager } from './session/manager.js';
export { MCPClient } from './mcp/client.js';
export { buildFullContext, loadContextFiles, getGitContext, detectCodingContext, isSensitivePath, containsSecrets } from './core/context.js';
export { estimateTokens, shouldCompact, compactMessages } from './core/compaction.js';
export { trackUsage, getSessionStats, formatStats, resetStats } from './core/cost-tracker.js';
export { recordToolFailure, recordToolSuccess, isStuck, classifyThinkingLevel, thinkingBudget } from './core/safety.js';

// Re-export types
export type { Provider, Message, StreamOptions, Tool, ToolCall, ToolResult, Effort, Dialect } from './providers/types.js';
export type { ToolDefinition, ToolTier } from './tools/types.js';
export type { AgentDef, AgentRunResult, WorkflowResult, AgentEvent } from './agents/orchestrator.js';
export type { Skill, SkillFrontmatter } from './skills/loader.js';
export type { Hook, HookType, HookResult } from './hooks/manager.js';
export type { Session } from './session/manager.js';
export type { Toolset } from './tools/toolsets.js';
export type { CompactionSettings } from './core/compaction.js';
export type { FullContext } from './core/context.js';

export const VERSION = '0.3.0';
export const NAME = 'Kairo';
