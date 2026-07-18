/**
 * Chat state management — actor model for conversation state.
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
import type { ConversationSummary } from '../compaction/summary.js';

export type ChatEventType =
  | 'message_added'
  | 'message_removed'
  | 'compaction_started'
  | 'compaction_completed'
  | 'compaction_failed'
  | 'state_reset'
  | 'summary_updated'
  | 'token_usage_changed';

export interface ChatEvent {
  type: ChatEventType;
  timestamp: Date;
  data: Record<string, unknown>;
}

export interface ChatStateConfig {
  maxMessages: number;
  maxTokens: number;
  enableCompaction: boolean;
  autoCompactRatio: number;
}

export const DEFAULT_CHAT_STATE_CONFIG: ChatStateConfig = {
  maxMessages: 1000,
  maxTokens: 200_000,
  enableCompaction: true,
  autoCompactRatio: 0.8,
};

export interface ChatState {
  messages: ChatMessage[];
  summary?: ConversationSummary;
  totalTokens: number;
  turnCount: number;
  toolCallCount: number;
  config: ChatStateConfig;
  events: ChatEvent[];
}

/**
 * Create a fresh chat state.
 */
export function createChatState(
  config: ChatStateConfig = DEFAULT_CHAT_STATE_CONFIG,
): ChatState {
  return {
    messages: [],
    totalTokens: 0,
    turnCount: 0,
    toolCallCount: 0,
    config,
    events: [],
  };
}

/**
 * Add a message to the state.
 */
export function addMessage(
  state: ChatState,
  message: ChatMessage,
): ChatState {
  const tokenCount = estimateMessageTokens(message);
  const newMessages = [...state.messages, message];

  const event: ChatEvent = {
    type: 'message_added',
    timestamp: new Date(),
    data: { role: message.role, tokens: tokenCount },
  };

  return {
    ...state,
    messages: newMessages,
    totalTokens: state.totalTokens + tokenCount,
    turnCount: message.role === 'user' ? state.turnCount + 1 : state.turnCount,
    toolCallCount: message.toolCalls
      ? state.toolCallCount + message.toolCalls.length
      : state.toolCallCount,
    events: [...state.events, event],
  };
}

/**
 * Remove the oldest messages to fit within token budget.
 */
export function trimToTokenBudget(
  state: ChatState,
  maxTokens: number,
): ChatState {
  if (state.totalTokens <= maxTokens) return state;

  let tokens = state.totalTokens;
  const messages = [...state.messages];

  // Always keep first message (system prompt)
  while (messages.length > 1 && tokens > maxTokens) {
    const removed = messages.shift()!;
    tokens -= estimateMessageTokens(removed);
  }

  return {
    ...state,
    messages,
    totalTokens: tokens,
  };
}

/**
 * Replace messages with a summary.
 */
export function applySummary(
  state: ChatState,
  summary: ConversationSummary,
  keptMessages: ChatMessage[],
): ChatState {
  const event: ChatEvent = {
    type: 'summary_updated',
    timestamp: new Date(),
    data: { summaryTokens: summary.summaryTokens },
  };

  return {
    ...state,
    messages: keptMessages,
    summary,
    totalTokens: keptMessages.reduce((sum, m) => sum + estimateMessageTokens(m), 0),
    events: [...state.events, event],
  };
}

/**
 * Reset the chat state.
 */
export function resetChatState(state: ChatState): ChatState {
  return {
    ...state,
    messages: [],
    summary: undefined,
    totalTokens: 0,
    turnCount: 0,
    toolCallCount: 0,
    events: [...state.events, { type: 'state_reset', timestamp: new Date(), data: {} }],
  };
}

function estimateMessageTokens(message: ChatMessage): number {
  let tokens = 0;
  if (message.content) tokens += Math.ceil(message.content.length / 4);
  if (message.toolCalls) {
    for (const tc of message.toolCalls) {
      tokens += Math.ceil(tc.function.arguments.length / 4);
    }
  }
  return tokens || 4;
}
