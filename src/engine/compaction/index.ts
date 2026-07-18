/**
 * Compaction subsystem — orchestrates context window management.
 */

export { compactConversation, createCompactionState, shouldCompact, type CompactionState, type CompactionRequest, type CompactionResult } from './compact.js';
export { computeThresholds, getCompactionModel, DEFAULT_COMPACTION_CONFIG, type CompactionConfig, type CompactionThresholds } from './config.js';
export { createFailureTracker, recordFailure, recordSuccess, isCircuitClosed, getRecentFailures, type CompactionFailureTracker, type CompactionFailure } from './failure.js';
export { buildCompactionSystemPrompt, buildCompactionUserMessage, buildSummaryOnlyPrompt, type CompactionPromptOptions } from './prompt.js';
export { parseSummaryFromOutput, mergeSummaries, truncateSummary, createSummary, type ConversationSummary } from './summary.js';
export { assembleCompactedConversation, validateAssembledConversation, type AssembleOptions } from './assemble.js';
