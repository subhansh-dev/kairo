/**
 * Compaction orchestrator — manages the full compaction lifecycle.
 */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool' | 'developer';
  content?: string;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  toolCallId?: string;
}
import type { CompactionConfig, CompactionThresholds } from './config.js';
import { DEFAULT_COMPACTION_CONFIG, computeThresholds } from './config.js';
import {
  createFailureTracker,
  recordFailure,
  recordSuccess,
  isCircuitClosed,
  type CompactionFailureTracker,
} from './failure.js';
import { buildCompactionSystemPrompt, buildCompactionUserMessage, type CompactionPromptOptions } from './prompt.js';
import { createSummary, type ConversationSummary } from './summary.js';
import { assembleCompactedConversation, type AssembleOptions } from './assemble.js';
import { selectTurnsToCompact, computeTokenCounts, type CompactionItem } from '../compaction-select.js';

export interface CompactionState {
  config: CompactionConfig;
  thresholds: CompactionThresholds;
  failureTracker: CompactionFailureTracker;
  lastSummary?: ConversationSummary;
  totalCompactions: number;
  totalTokensSaved: number;
}

export interface CompactionRequest {
  messages: ChatMessage[];
  currentTokens: number;
  model?: string;
  agentType?: string;
}

export interface CompactionResult {
  compacted: boolean;
  messages?: ChatMessage[];
  summary?: ConversationSummary;
  tokensSaved: number;
  error?: string;
}

/**
 * Create a fresh compaction state.
 */
export function createCompactionState(
  contextWindow: number,
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
): CompactionState {
  return {
    config,
    thresholds: computeThresholds(contextWindow, config),
    failureTracker: createFailureTracker(),
    totalCompactions: 0,
    totalTokensSaved: 0,
  };
}

/**
 * Check if compaction should trigger.
 */
export function shouldCompact(
  state: CompactionState,
  currentTokens: number,
): boolean {
  if (!isCircuitClosed(state.failureTracker)) return false;
  return currentTokens >= state.thresholds.trigger;
}

/**
 * Execute compaction on a conversation.
 */
export function compactConversation(
  state: CompactionState,
  request: CompactionRequest,
  summaryFn: (systemPrompt: string, userMessage: string) => string,
): CompactionResult {
  const { messages, currentTokens } = request;

  // Convert to CompactionItem format
  const items: CompactionItem[] = messages.map(m => ({
    role: m.role as CompactionItem['role'],
    text: m.content ?? undefined,
    hasToolRequests: !!m.toolCalls?.length,
    isCompactionSummary: false,
  }));

  const tokenCounts = computeTokenCounts(items);

  // Find split point
  const split = selectTurnsToCompact(
    tokenCounts,
    items,
    state.thresholds.keep,
    state.thresholds.minCompactable,
  );

  if (!split) {
    return { compacted: false, tokensSaved: 0 };
  }

  // Split messages
  const toCompact = messages.slice(0, split.splitIdx);
  const kept = messages.slice(split.splitIdx);

  // Build and execute compaction prompt
  const promptOptions: CompactionPromptOptions = {
    messages: toCompact,
    existingSummary: state.lastSummary?.text,
    agentType: request.agentType,
    includeToolCalls: true,
    maxSummaryTokens: state.config.summaryMaxTokens,
  };

  const systemPrompt = buildCompactionSystemPrompt();
  const userMessage = buildCompactionUserMessage(promptOptions);

  try {
    const rawOutput = summaryFn(systemPrompt, userMessage);

    const summary = createSummary(
      rawOutput,
      toCompact.length,
      split.tokensToCompact,
      0,
      split.splitIdx,
      request.model,
    );

    if (!summary) {
      const newState = {
        ...state,
        failureTracker: recordFailure(state.failureTracker, 'Failed to parse summary', 'summary'),
      };
      return { compacted: false, tokensSaved: 0, error: 'Failed to parse summary output' };
    }

    // Assemble compacted conversation
    const compacted = assembleCompactedConversation({
      summary,
      keptMessages: kept,
      includeMarker: true,
    });

    const tokensSaved = currentTokens - estimateCompactedTokens(compacted);
    const newState = {
      ...state,
      lastSummary: summary,
      totalCompactions: state.totalCompactions + 1,
      totalTokensSaved: state.totalTokensSaved + tokensSaved,
      failureTracker: recordSuccess(state.failureTracker),
    };

    // Update state in place (caller's responsibility)
    Object.assign(state, newState);

    return {
      compacted: true,
      messages: compacted,
      summary,
      tokensSaved,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    const newState = {
      ...state,
      failureTracker: recordFailure(state.failureTracker, errMsg, 'summary'),
    };
    Object.assign(state, newState);
    return { compacted: false, tokensSaved: 0, error: errMsg };
  }
}

function estimateCompactedTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) {
    if (m.content) total += Math.ceil(m.content.length / 4);
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        total += Math.ceil(tc.function.arguments.length / 4);
      }
    }
  }
  return total;
}
