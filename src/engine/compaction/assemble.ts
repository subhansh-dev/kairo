/**
 * Compaction assembler — reconstructs conversation after compaction.
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
import type { ConversationSummary } from './summary.js';

export interface AssembleOptions {
  /** The summary produced by compaction */
  summary: ConversationSummary;
  /** Messages that were kept (not compacted) */
  keptMessages: ChatMessage[];
  /** System prompt to preserve */
  systemPrompt?: string;
  /** Whether to include a summary marker message */
  includeMarker: boolean;
}

/**
 * Assemble a compacted conversation: summary + kept messages.
 */
export function assembleCompactedConversation(
  options: AssembleOptions,
): ChatMessage[] {
  const { summary, keptMessages, systemPrompt, includeMarker } = options;
  const result: ChatMessage[] = [];

  // Preserve system prompt
  if (systemPrompt) {
    result.push({
      role: 'system',
      content: systemPrompt,
    });
  }

  // Add summary as a developer message
  result.push({
    role: 'developer',
    content: buildSummaryMessage(summary, includeMarker),
  });

  // Add the kept messages
  result.push(...keptMessages);

  return result;
}

/**
 * Build the summary message content.
 */
function buildSummaryMessage(
  summary: ConversationSummary,
  includeMarker: boolean,
): string {
  const parts: string[] = [];

  if (includeMarker) {
    parts.push('[COMPACTED CONVERSATION — Summary of previous messages]');
    parts.push('');
  }

  parts.push(summary.text);

  if (includeMarker) {
    parts.push('');
    parts.push(`[Compacted ${summary.messageCount} messages, ~${summary.originalTokens} tokens → ~${summary.summaryTokens} tokens]`);
  }

  return parts.join('\n');
}

/**
 * Validate that assembled conversation is well-formed.
 */
export function validateAssembledConversation(
  messages: ChatMessage[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (messages.length === 0) {
    errors.push('Conversation is empty');
    return { valid: false, errors };
  }

  // First message should be system or developer
  const first = messages[0];
  if (first.role !== 'system' && first.role !== 'developer') {
    errors.push(`First message should be system/developer, got ${first.role}`);
  }

  // No two consecutive messages from the same role (except tool results)
  for (let i = 1; i < messages.length; i++) {
    const prev = messages[i - 1];
    const curr = messages[i];
    if (prev.role === curr.role && curr.role !== 'tool' && prev.role !== 'tool') {
      errors.push(`Consecutive ${curr.role} messages at index ${i - 1} and ${i}`);
    }
  }

  // Tool results should follow assistant messages with tool calls
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === 'tool') {
      const prev = messages[i - 1];
      if (!prev || (prev.role !== 'assistant' || !prev.toolCalls?.length)) {
        errors.push(`Tool result at index ${i} without preceding assistant tool call`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
