/**
 * Engine module — extracted patterns, hooks, compaction, and utilities.
 */

// Secrets
export { redactSecrets, redactJsonStringValues, redactUserPaths, redactUrl } from './secrets.js';

// Hooks
export * from './hooks/index.js';

// Compaction selection
export { selectTurnsToCompact, computeTokenCounts } from './compaction-select.js';
export type { CompactionItem, SplitPlan } from './compaction-select.js';

// Hunk tracker
export { computeHunks, generateUnifiedPatch, generateHunkPatch, patchLines, findMatchingOldHunk, hunksOverlap, hunksMatchContent } from './hunk-tracker.js';
export type { Hunk, HunkLineInfo, HunkSource } from './hunk-tracker.js';

// Compaction subsystem
export * from './compaction/index.js';

// Circuit breaker
export { createCircuitBreaker, canExecute, recordBreakerSuccess, recordBreakerFailure, resetCircuitBreaker, CircuitState, DEFAULT_CIRCUIT_BREAKER_CONFIG } from './circuit-breaker/index.js';
export type { CircuitBreaker, CircuitBreakerConfig } from './circuit-breaker/index.js';

// Models
export { MODELS, getModel, getModelsByProvider, getModelsByTier, getDefaultModel, listProviders } from './models/index.js';
export type { ModelDef, ModelProvider } from './models/index.js';

// Sampler
export { isSamplerError, defaultSamplerConfig } from './sampler/index.js';
export type { SamplerMessage, SamplerConfig, SamplerResult, SamplerError, SamplerFn } from './sampler/index.js';

// Tool protocol
export { createRequest, createResponse, createNotification, isRequest, isResponse, isNotification, ERROR_CODES, METHODS } from './tool-protocol/index.js';
export type { JSONRPCRequest, JSONRPCResponse, JSONRPCNotification, JSONRPCMessage, JSONRPCError, MethodName } from './tool-protocol/index.js';

// Tool types
export { createToolCall, createToolResult } from './tool-types.js';
export type { ToolDefinition, ToolResult, ToolCategory, ToolPermission, TaskType, TaskDefinition } from './tool-types.js';

// Tool runtime
export { createDispatcher, createToolError, searchTools } from './tool-runtime/index.js';
export type { ToolContext, ToolDispatcher, ToolHandler, ToolError } from './tool-runtime/index.js';

// Chat state
export { createChatState, addMessage, trimToTokenBudget, applySummary, resetChatState, DEFAULT_CHAT_STATE_CONFIG } from './chat-state/index.js';
export type { ChatState, ChatStateConfig, ChatEvent, ChatEventType } from './chat-state/index.js';

// Environment
export { detectEnvironment, getEnvironmentPresets } from './env.js';
export type { EnvInfo } from './env.js';

// Paths
export { resolveWorkspacePath, getHomeDir, getConfigDir, getDataDir, getCacheDir, normalizePath, makeRelative } from './paths.js';

// Auth
export { createStaticAuthProvider, withRetry, buildAuthHeaders } from './auth/index.js';
export type { AuthConfig, AuthToken, AuthProvider } from './auth/index.js';

// Memory
export { createMemoryEntry, searchMemory, evictOldEntries, mergeSimilarEntries, DEFAULT_MEMORY_CONFIG } from './memory/index.js';
export type { MemoryEntry, MemoryConfig } from './memory/index.js';

// Workspace
export * from './workspace/index.js';
export type { WorkspaceIdentity, WorkspaceMetadata, WorkspaceConfig, WorkspacePermission, WorkspaceRequest, WorkspaceChunk, WorkspaceEvent } from './workspace/types.js';

// Version
export { VERSION, CODENAME, getVersionInfo, formatVersion } from './version.js';
export type { VersionInfo } from './version.js';

// Update
export { checkForUpdates, formatUpdateResult } from './update.js';
export type { UpdateCheckResult } from './update.js';

// Subagent
export { resolveSubagentConfig, getSubagentTypes } from './subagent/index.js';
export type { SubagentType, SubagentConfig, SubagentOverride } from './subagent/index.js';

// Voice
export { transcribe, synthesize, DEFAULT_VOICE_CONFIG } from './voice.js';
export type { VoiceConfig, TranscriptionResult } from './voice.js';

// Mermaid
export { generateFlowchart, generateSequenceDiagram, renderMermaidHtml } from './mermaid.js';
export type { MermaidDiagram } from './mermaid.js';

// Markdown
export { stripMarkdown, extractCodeBlocks, countWords, extractLinks } from './markdown/index.js';

// Markdown core (parser)
export { parseMarkdown, extractHeadings } from './markdown-core/index.js';
export type { MarkdownNode } from './markdown-core/index.js';

// Codebase graph
export { createGraph, addSymbol, addReference, addDependency, symbolsInFile, findReferences, dependenciesOfFile, dependentsOfFile, findSymbolsByName, findSymbolsByKind, transitiveDependencies, impactSet, graphStats } from './codebase-graph/index.js';
export type { Symbol, SymbolKind, SymbolReference, DependencyEdge, CodebaseGraph } from './codebase-graph/index.js';

// Crash handler
export { installCrashHandler, getCrashReports, clearCrashReports } from './crash-handler/index.js';
export type { CrashReport, CrashHandlerConfig } from './crash-handler/index.js';

// Fast worktree
export { createWorktree, listWorktrees, removeWorktree, pruneWorktrees, isGitRepo, getGitRoot } from './fast-worktree/index.js';
export type { WorktreeConfig, WorktreeInfo } from './fast-worktree/index.js';

// File utils
export { safeReadFile, safeWriteFile, safeDeleteFile, fileExists, safeStat, safeListDir, listAllFiles, getFileSize, readJsonFile, writeJsonFile, safeCopyFile, tempPath } from './file-utils/index.js';

// Fsnotify
export { createFsWatcher, debounceFsEvents } from './fsnotify/index.js';
export type { FsEvent, FsNotifyEvent, FsNotifyCallback, FsWatcher } from './fsnotify/index.js';

// Agent lifecycle
export { createLifecycle, isValidTransition, formatLifecycleHistory } from './agent-lifecycle/index.js';
export type { LifecyclePhase, LifecycleEvent, LifecycleHook, AgentLifecycle } from './agent-lifecycle/index.js';

// HTTP client
export { createHttpClient } from './http/index.js';
export type { HttpConfig, HttpResponse, HttpError } from './http/index.js';

// Sandbox
export { sandboxExec, createSandboxDir, cleanupSandboxDir } from './sandbox/index.js';
export type { SandboxConfig, SandboxResult } from './sandbox/index.js';

// Shared
export { ok, err, unwrap, unwrapOr, mapResult, retry, withTimeout, deepClone, pick, omit, throttle } from './shared/index.js';
export type { Result } from './shared/index.js';

// Config types
export { defaultAppConfig, validateProviderConfig, validateAgentConfig } from './config-types/index.js';
export type { ProviderConfig, AgentConfig, SessionConfig, AppConfig, UserPreferences } from './config-types/index.js';

// Telemetry
export { createTelemetryLogger, formatTelemetryEntry } from './telemetry/index.js';
export type { TelemetryLevel, TelemetryEntry, TelemetryConfig, TelemetryLogger } from './telemetry/index.js';

// Tracing
export { createSpan, finishSpan, addSpanEvent, spanDurationMs, createTrace, addSpanToTrace, findRootSpan, findChildSpans } from './tracing-mod/index.js';
export type { Span, SpanEvent, Trace } from './tracing-mod/index.js';

// Analytics
export { createAnalytics } from './analytics/index.js';
export type { AnalyticsEvent, AnalyticsConfig } from './analytics/index.js';

// Test support
export { createTestDir, cleanupTestDir, createTestFile, readTestFile, createTestGitRepo, createMockConversation, sleep, waitFor } from './test-support/index.js';

// SQLite journal
export { createJournalConfig, writeJournalEntry, readJournalEntries, journalEntryCount, listJournalSessions, deleteJournalSession } from './sqlite-journal/index.js';
export type { JournalEntry, JournalConfig } from './sqlite-journal/index.js';

// System power
export { getPowerInfo, isOnBattery, isBatteryLow } from './system-power/index.js';
export type { PowerInfo } from './system-power/index.js';

// TTY utils
export { detectTty, truncateToWidth, padRight, centerText, horizontalRule, stripAnsi, hasAnsi } from './tty-utils/index.js';
export type { TtyInfo } from './tty-utils/index.js';

// Prompt queue
export { createPromptQueue } from './prompt-queue/index.js';
export type { PromptRequest, PromptQueue, PromptStatus } from './prompt-queue/index.js';

// Token estimation
export { estimateTextTokens, estimateCodeTokens, estimateJsonTokens, estimateMessageTokens, estimateConversationTokens, estimateSystemPromptTokens, formatTokenCount } from './token-estimation/index.js';

// Interjection
export { createInterjectionBuffer, addInterjection, getPendingInterjections, clearInterjections, formatInterjection } from './interjection/index.js';
export type { InterjectionEvent, InterjectionBuffer } from './interjection/index.js';

// Shell
export { execCommand, execStdout, commandExists } from './shell-base/index.js';
export type { ShellCommand, ShellResult } from './shell-base/index.js';
export { createShellSession, execInSession, getSessionHistory, clearSessionHistory } from './shell/index.js';
export type { ShellSession, ShellHistoryEntry } from './shell/index.js';

// Tools API
export { createToolApiRegistry, generateOpenApiSpec } from './tools-api/index.js';
export type { ToolApiDefinition, ToolApiRegistry } from './tools-api/index.js';

// Hooks plugins types
export { createHookPlugin, validateHookPluginManifest } from './hooks-plugins-types/index.js';
export type { HookPlugin, HookPluginManifest, HookPluginType } from './hooks-plugins-types/index.js';

// Plugin marketplace
export { createPluginMarketplace } from './plugin-marketplace/index.js';
export type { PluginInfo, PluginMarketplace } from './plugin-marketplace/index.js';

// Announcements
export { createAnnouncement, isActive, activeAnnouncements, dismissAnnouncement } from './announcements/index.js';
export type { Announcement } from './announcements/index.js';

// Workspace client
export { createWorkspaceClient } from './workspace-client/index.js';
export type { WorkspaceClientConfig, WorkspaceProject } from './workspace-client/index.js';

// Sampling types
export { detectDoomLoop } from './sampling-types/index.js';
export type { SamplingMessage, SamplingParams, SamplingResult, TokenUsage, MessageRole } from './sampling-types/index.js';

// ACP (Agent Communication Protocol)
export { acpOk, acpErr, createAcpChannel, acpMethodName, ACP_AGENT_METHODS, ACP_CLIENT_METHODS } from './acp/index.js';
export type { AcpResult, AcpError, AcpChannel, AcpAgentMessage, AcpClientMessage, InitializeRequest, InitializeResponse, AcpPromptRequest, PromptResponse, SessionNotification, SessionUpdate, AcpContentBlock, AcpMessage } from './acp/index.js';

// Config loader
export { loadConfig, saveConfig, defaultConfig, validateConfig, applyOverrides, checkVersionOverrides, writeAtomic, getConfigPaths } from './config-loader/index.js';
export type { KairoConfig, ConfigProviderEntry, ConfigAgentEntry, HookEntry, Preferences, ConfigOverrides, VersionOverride } from './config-loader/index.js';

// Workspace types extended
export { createRpcRequest, createRpcResponse, createRpcNotification, WORKSPACE_ERROR_CODES, WorkspaceError } from './workspace-types-ext/index.js';
export type { WorkspaceTool, WorkspaceSkill, WorkspaceSession as WorkspaceSessionType, WorkspaceSearchQuery, WorkspaceSearchResult, WorkspacePlugin, WorkspacePermissionRule, WorkspaceMemoryEntry, WorkspaceHunk, WorkspaceGitStatus, WorkspaceFileInfo, WorkspaceConfigEntry, RpcEnvelope, WorkspaceEventType } from './workspace-types-ext/index.js';

// Taxonomy (tool kinds, namespaces, presentation names)
export { getPresentationName, isReadOnly, createToolIdentity, createCanonicalToolMeta, mergeToolMeta, CANONICAL_FIELDS, TOOL_META_KEY, TOOL_META_VERSION } from './taxonomy.js';
export type { ToolKind, ToolNamespace, ToolIdentity, CanonicalToolMeta } from './taxonomy.js';

// Tools (bash, read_file, search_replace, grep, list_dir, web_fetch, web_search)
export { createBuiltinTools, executeBash, readFile, searchReplace, grep, listDir, webFetch, webSearch } from './tools/index.js';
export type { ToolInput, ToolOutput, ToolCallContext, BashInput, BashOutput, ReadFileInput, SearchReplaceInput, GrepInput, GrepMatch, ListDirInput, WebFetchInput, WebSearchInput, ToolDefinition as ToolImplDefinition } from './tools/index.js';

// Trust store (folder trust decisions)
// Trust store now in trust.ts — re-export from there
export { TrustStore, workspaceKey, isHomeDir, isUnsafeTrustRoot } from './trust.js';
export type { FolderTrust, TrustDocument } from './trust.js';

// Permission system (types, rules, evaluation)
export { evaluatePermission, parsePermissionRule, toolFilterMatches, globMatch, domainMatch, isSafeCommand, isDangerousCommand, defaultPermissionConfig, defaultPermissionState, clientTypeFromIdentifier } from './permission.js';
export type { AccessKind, Decision, EditPolicy, PromptPolicy, ToolFilter, PatternMode, RuleAction, PermissionRule, PermissionConfig, PermissionState, PermissionEvent, ClientType } from './permission.js';

// Session management (checkpoints, file state, git checkpoints)
export { CheckpointStore, GitCheckpointStore, FileStateTracker, createWorkspaceSessionId } from './session.js';
export type { SessionInfo, HunkCheckpoint, HunkDelta, GitCheckpoint, FileState, WorkspaceSessionConfig, ExtMethodError, ExtMethodResult } from './session.js';

// Discovery (skills, plugins, AGENTS.md, project config, permissions)
// Discovery now in discovery.ts — re-export from there
export { discoverSkills, discoverAgentsMd, discoverPlugins, loadProjectConfig, loadPermissions } from './discovery.js';
export type { SkillInfo, SkillsConfig, AgentConfigFile, DiscoveredPlugin, PluginDiscoveryConfig, ProjectConfig, ResolvedPermissions } from './discovery.js';

// Permission policy (compiled rules, deny>ask>allow precedence, bash segment eval)
export { createCompiledPolicy, evaluatePolicy, evaluateBashCommandPolicy, ruleIsCatchAll } from './permission/policy.js';
export type { CompiledPolicy } from './permission/policy.js';

// Permission rules (DSL parser, default mode effects)
export { parsePermissionRule as parsePermissionRuleString, getDefaultModeEffects } from './permission/rules.js';
export type { DefaultPermissionMode, DefaultModeEffects } from './permission/rules.js';

// Permission state (persistence, cleanup)
export { loadStateFromDisk, persistState, cleanupStalePermissionState } from './permission/state.js';

// Filesystem (async fs, local fs, file tree, git status, fuzzy match)
export { AsyncFsWrapper, listContents, gitStatus, gitStatusShort } from './filesystem/index.js';
export type { ListContentsLimits, FuzzyMatchResult } from './filesystem/index.js';

// Workspace errors
export { WorkspaceError as EngineWorkspaceError } from './workspace-errors.js';
export type { WorkspaceErrorKind, WorkspaceResult } from './workspace-errors.js';

// Capability mode filtering
export { getCapabilityMode, isToolAllowed, createCapabilityConfig, filterToolsByCapability, getAllowedTools } from './capability.js';
export type { CapabilityMode, CapabilityRule, CapabilityConfig } from './capability.js';

// Activity tracking
export { createActivityTracker, recordActivity, getActivitySummary, getRecentActivity, getActivityByType, getFailedActivity, serializeActivity, deserializeActivity } from './activity.js';
export type { ActivityType, ActivityEntry, SessionActivity, ActivityStats } from './activity.js';

// Recovery state
export { createRecoveryState, loadRecoveryState, saveRecoveryState, addPendingUpload, removePendingUpload, setCheckpoint as setRecoveryCheckpoint, getCheckpoint as getRecoveryCheckpoint, removeCheckpoint as removeRecoveryCheckpoint, cleanupStaleState, getFilesNeedingRecovery, needsRecovery } from './recovery.js';
export type { RecoveryState, PendingUpload, RecoveryCheckpoint } from './recovery.js';

// MCP integration
export { qualifyToolName, unqualifyToolName, mcpToolToIdentity, createMcpBridgeConfig } from './mcp.js';
export type { McpServerInfo, McpToolDefinition, McpCallResult, McpContent, McpTransport, McpBridgeConfig } from './mcp.js';

// RPC envelope
export { rpcOk, rpcErr, getWireCode, getErrorKind, parseRpcError, createRpcError, isRpcError, unwrapRpc } from './rpc_envelope.js';
export type { RpcErrorCode, RpcError } from './rpc_envelope.js';

// Workspace config
export { createWorkspaceConfig, validateWorkspaceConfig } from './config.js';
export type { SessionTerminalBackend, WorkspaceBindConfig, HubConfig, WorkspaceConfig as EngineWorkspaceConfig } from './config.js';

// Status config
export { createStatusConfig } from './status_config.js';
export type { StatusConfig } from './status_config.js';

// Workspace handle
export { createWorkspaceHandle, bindSession, unbindSession, getSession, getActiveSessions, pruneIdleSessions, startDrain, completeDrain } from './handle.js';
export type { WorkspaceSession as HandleSession, WorkspaceHandle as HandleWorkspaceHandle } from './handle.js';

// Checkpoint management
export { turnStart, turnEnd, rewindBegin, rewindFinalize, rewindHunksEnabled, rewindDurableEnabled } from './checkpoint.js';
export type { RewindCheckpoint, HunkTurnDelta, HunkFileState, TurnBoundaryKind, TurnBoundary } from './checkpoint.js';

// File state tracking
export { createRewindPoint, addSnapshot, rewindFiles, getRewindSummary } from './file_state.js';
export type { FileSnapshot, RewindPoint, FileRewindResponse } from './file_state.js';

// Tool config resolution
export { backfillToolKinds, mergeMcpTools, mergeHubTools, filterByCapability, buildFinalizedToolset, resolveSessionToolset } from './tool_config.js';
export type { ToolConfig as EngineToolConfig, ToolServerConfig, FinalizedToolset } from './tool_config.js';

// Workspace telemetry events
export { emitTelemetry, emitToolStateEvent, emitDrainEvent } from './telemetry.js';
export type { TelemetryPhase, TelemetryEvent } from './telemetry.js';

// Environment variable loading
export { loadEnvrc } from './envrc.js';

// SSRF protection
export { checkSsrf, isBlockedIp, isBlockedIPv4, SsrfError } from './ssrf.js';

// Domain allowlist matching
export { normalizeDomain, DomainMatcher } from './domain.js';

// Enhanced ReadFile
export { readFileWithLines, readFileContent, formatLines, parsePageRange, isPdfFile, isPptxFile, isImageFile, isNotebookFile, resolveFilePath, MAX_NUM_TOKENS, MAX_LINES_READ } from './read_file.js';
export type { ReadFileInput as EnhancedReadFileInput, FileLine, ReadFileOutput } from './read_file.js';

// Enhanced SearchReplace
export { runSearchReplace } from './search_replace.js';
export type { SearchReplaceInput as EnhancedSearchReplaceInput, SearchReplaceEditDetail, SearchReplaceOutput } from './search_replace.js';

// Enhanced WebFetch
export { runWebFetch } from './web_fetch.js';
export type { WebFetchParams, WebFetchOutput } from './web_fetch.js';

// Permission types
export { getUserAgentLabel, createPermissionEvent } from './permission_types.js';
export type { PermissionGrant } from './permission_types.js';
export type { PermissionEvent as PermissionEventType, PermissionMode } from './permission_types.js';

// Git operations
export { gitCli, gitStage, gitUnstage, gitCommit, gitDiscard, gitBranchList, gitDiff } from './git.js';
export { gitStatus as gitDetailedStatus } from './git.js';
export type { GitStatus, GitFileChange, GitCommitResult, GitBranchEntry } from './git.js';

// Shell access detection
export { getShellFileModes, extractFileOperands, evaluateShellFileAccess } from './shell_access.js';
export type { ShellFileMode } from './shell_access.js';

// Auto permission mode (LLM classifier)
export { fastPathClassify, buildClassifierMessages, parseClassifierResponse } from './auto_mode.js';
export type { ClassifierVerdict, ClassifierMessageRole, ClassifierPromptType, ClassifierMessage, ClassifierTurn } from './auto_mode.js';

// Checkpoint store (disk-backed)
export { DiskCheckpointStore } from './checkpoint_store.js';

// Compact git status
export { gitStatusCompact, gitStatusDetailed } from './git_status.js';

// File tree generation
export { generateFileTree, renderFileTree } from './file_tree.js';
export type { FileTreeOptions, FileTreeNode, FileTreeResult } from './file_tree.js';

// Filesystem walk primitives
export { walkFsEntries, readRange, encodeChunk, clampReadLength, MAX_LIST_COLLECT, MAX_READ_BYTES } from './fs_walk.js';
export type { FsWalkOptions, RawFsEntry } from './fs_walk.js';

// Fuzzy file matching
export { fuzzySearchFiles, fuzzyMatchPath } from './fuzzy.js';

// Todo tool (task list management)
export { validateNoDuplicateIds, applyReplace, applyMerge, renderTodoState, TodoState } from './todo.js';
export type { TodoStatus, TodoPriority, TodoItem, TodoUpdate } from './todo.js';

// Bash command splitting (permission evaluation)
export { unwrapWrappers, wrapperHasChdir, primaryCommandFromScript, getBashCommandHighlights, isWrapperCommand, stripWrapperCommand, isWordOnlySequence, splitByOperators } from './bash_splitting.js';
export type { PlainCommand, BashCommandHighlights } from './bash_splitting.js';

// Monitor tool (background command watching)
export { createMonitor, stopMonitor, killMonitor, getMonitorOutput, listMonitors, Monitor, LINE_TRUNCATION_LIMIT, BATCH_TRUNCATION_LIMIT, BUFFER_CAP_BYTES, DEBOUNCE_MS, RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_MS, AUTO_KILL_THRESHOLD_MS, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, MAX_RESULT_SIZE_CHARS } from './monitor.js';
export type { MonitorInput, MonitorOutput, MonitorEvent } from './monitor.js';

// Kill task tool
export { killTask, killTerminalCommand } from './kill_task.js';
export type { KillTaskInput, KillTaskOutput } from './kill_task.js';

// Claude settings interop
export { loadClaudeSettings, findClaudeSettings, convertClaudePermissions, getDefaultMode } from './claude_settings.js';
export type { ClaudeSettings, ParsedPermissions, ClaudePermissionConfig } from './claude_settings.js';

// Session file storage
export { SessionFileWriter, ensureSessionFolder } from './storage.js';

// Scheduler (recurring/one-shot tasks)
export * from './scheduler/index.js';

// Content search (ripgrep-based)
export { contentSearch, contentSearchStreaming } from './content_search.js';
export type { ContentSearchParams, ContentMatch, ContentMatchFile, ContentSearchData, ContentSearchBatch } from './content_search.js';

// Preview supervisor
export { PreviewSupervisor, PREVIEW_PROXY_BIN_PATH, PREVIEW_PROXY_LOG_PATH, PREVIEW_PROXY_HEALTHY_RUN_SECS, PreviewVisibility } from './preview_supervisor.js';
export type { PreviewSupervisorOptions } from './preview_supervisor.js';

// Hub auth
export { createAuthProvider, readAuthEntries, findActiveOidcEntry, BearerAuthProvider } from './hub_auth.js';
export type { AuthEntry, AuthIdentity, AuthCredential, AuthProvider as HubAuthProvider } from './hub_auth.js';

// Hub channel
export { extractWorkspaceEvent, extractToolNotification, consumeStreamTerminal } from './hub_channel.js';
export type { ToolNotificationFrame, WireToolNotification, WorkspaceEvent as HubWorkspaceEvent, ToolNotification } from './hub_channel.js';

// Hub IDs
export { WORKSPACE_RPC_TOOL_ID, WORKSPACE_EVENTS_TOOL_ID, WORKSPACE_TOOL_NOTIFICATIONS_TOOL_ID, WORKSPACE_CLIENT_EXT_NOTIFICATIONS_TOOL_ID } from './hub_ids.js';

// Workspace RPC handler
export { WorkspaceRpcHandler, resolveMutationCaller } from './hub_server.js';
export type { RpcRequest, RpcResponse, RpcMetrics } from './hub_server.js';

// Workspace operations
export { LocalWorkspaceHandle, ProxyWorkspaceHandle } from './workspace_ops.js';
export type { WorkspaceHandle as WorkspaceOpsHandle, WorkspaceRpc, WorkspaceOp, DirEntry as WorkspaceDirEntry, GitStatus as OpsGitStatus, GitDiffOptions, CodeNavLocation, HunkActionRequest, WorkspaceInfo } from './workspace_ops.js';

// File system modules
export * from './file_system/index.js';

// Task output
export { cappedWaitTimeout, formatTaskOutput, formatMultiTaskOutput, DEFAULT_WAIT_TIMEOUT_MS, MAX_WAIT_BLOCK_MS } from './task_output.js';
export type { TaskOutputResult, MultiTaskOutputResult, TaskOutputToolInput } from './task_output.js';

// Workspace errors (v2)
export { WorkspaceError as WorkspaceErrorV2 } from './workspace_errors_v2.js';
export type { WorkspaceErrorKind as WorkspaceErrorKindV2, WorkspaceResult as WorkspaceResultV2 } from './workspace_errors_v2.js';

// Folder trust decisions
export { decide, decideInputs, grantFolderTrust, hasRepoConfigs, TrustOutcome } from './folder_trust.js';
export type { DecideInputs } from './folder_trust.js';

// FsNotify adapter
export { isUnderHiddenDir, forwardToHunkTracker, fsEventToCodebaseGraphEvent, toWorkspaceEventKind, createFsEventForwarder, FsEventKind } from './fs_notify.js';
export type { FsEvent as NotifyFsEvent, HunkTrackerHandle, CodebaseGraphHandle, FileEvent, FileEventKind } from './fs_notify.js';

// Project config discovery
export { findGitRoot, getRepoDirChain, findMcpJsonFiles, findProjectConfigs, findProjectConfigsIn, MCP_JSON_FILENAME } from './project_config.js';

// File system: local_fs
export { LocalFs } from './file_system/local_fs.js';
export type { AsyncFileSystem as LocalAsyncFileSystem } from './file_system/local_fs.js';

// File system: walk
export { walkDir, walkDirCollect, countFiles, findFiles } from './file_system/walk.js';
export type { WalkOptions, WalkEntry } from './file_system/walk.js';

// File system: attach_file
export { parseFileReference, renderFileReference, contentHash } from './file_system/attach_file.js';
export type { FileReference } from './file_system/attach_file.js';

// Permission manager
export { createPermissionManager, PermissionManager } from './permission/manager.js';
export type { PermissionHandle, PermissionManagerOptions } from './permission/manager.js';

// Permission: hub_permission
export { resolveHubPermissionMode } from './permission/hub_permission.js';
export type { HubPermissionConfig } from './permission/hub_permission.js';

// Permission: prompter
export { createPrompter, AcpPrompter } from './permission/prompter.js';
export type { Prompter, PromptOutcome } from './permission/prompter.js';

// Permission: resolution
export { resolvePermissions } from './permission/resolution.js';
export type { ResolvedPermission } from './permission/resolution.js';

// Session: swap policy
export { shouldSwap, SwapPolicy } from './session/swap_policy.js';
export type { SwapPolicyConfig } from './session/swap_policy.js';

// Session: Jujutsu VCS
export { jjStatus, isJjRepo } from './session/jj.js';
export type { JjStatus, JjFileChange } from './session/jj.js';

// Task tool (subagent launcher)
export { TaskTool, MAX_SUBAGENT_DEPTH, TASK_TOOL_NAME } from './task.js';
export type { TaskToolInput, SubagentRequest, SubagentRuntimeOverrides, SubagentResult, SubagentSnapshot, SubagentSnapshotStatus, TaskBackend } from './task.js';

// Update goal
export { UPDATE_GOAL_TOOL_NAME, UpdateGoalAckType, RejectReason } from './update_goal.js';
export type { UpdateGoalInput, UpdateGoalAck } from './update_goal.js';

// Web search (enhanced)
export { WEB_SEARCH_TOOL_NAME } from './web_search.js';
export type { WebSearchInput as WebSearchToolInput, WebSearchOutput as WebSearchToolOutput, WebSearchResult as WebSearchToolResult, WebSearchClient } from './web_search.js';

// Image generation
export { createImageGenClient, IMAGE_GEN_TOOL_NAME, IMAGINE_COMMAND_NAME, TIER_RESTRICTED_UPSELL } from './image_gen.js';
export type { ImageGenConfig, ImageGenClient, ImageGenOptions, ImageGenOutput } from './image_gen.js';

// Image edit
export { compressReference, IMAGE_EDIT_TOOL_NAME } from './image_edit.js';
export type { ImageEditInput } from './image_edit.js';

// Video generation
export { createVideoGenClient, IMAGE_TO_VIDEO_TOOL_NAME, REFERENCE_TO_VIDEO_TOOL_NAME, IMAGINE_VIDEO_COMMAND_NAME } from './video_gen.js';
export type { VideoGenConfig, VideoGenClient, VideoGenOptions, VideoGenOutput, S3AccessCredentials } from './video_gen.js';

// LSP integration
export { detectLspServers } from './lsp.js';
export type { LspServer, LspDiagnostic, LspDefinition, LspReference } from './lsp.js';

// Enter plan mode
export { seedPlanFile, ENTER_PLAN_MODE_TOOL_NAME } from './enter_plan_mode.js';
export type { EnterPlanModeInput, EnterPlanModeOutput, PlanFileSeedStatus } from './enter_plan_mode.js';

// Exit plan mode
export { readPlanFile, defaultPlanPath, EXIT_PLAN_MODE_TOOL_NAME } from './exit_plan_mode.js';
export type { ExitPlanModeInput, ExitPlanModeOutput, ExitPlanModeExtRequest, ExitPlanModeExtResponse } from './exit_plan_mode.js';

// Ask user question
export { validateQuestions, ASK_USER_QUESTION_TOOL_NAME, AskUserQuestionMode } from './ask_user_question.js';
export type { Question, QuestionOption, AskUserQuestionInput, AskUserQuestionOutput, QuestionAnswer, AskUserQuestionExtRequest, AskUserQuestionExtResponse, QuestionAnnotation } from './ask_user_question.js';
