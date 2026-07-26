/**
 * Kairo — Provider Normalization
 * Normalizes messages for specific provider quirks.
 * - Cerebras: strips thinking blocks (not supported)
 * - Groq: strips thinking blocks
 * - Deepseek: preserves thinking blocks (native support)
 */

import type { ChatMessage } from '../providers/registry.js';

/**
 * Strip thinking/reasoning blocks from assistant messages.
 * Some providers (Cerebras, Groq) don't support thinking tokens in history.
 * Sending them causes errors or wastes context.
 */
export function stripThinkingBlocks(messages: ChatMessage[]): ChatMessage[] {
  let hasThinking = false;

  // Check if any assistant message contains thinking content
  for (const msg of messages) {
    if (msg.role === 'assistant' && typeof msg.content === 'string') {
      // Check for thinking XML tags or reasoning markers
      if (/<thinking>|<reasoning>|\[thinking\]/i.test(msg.content)) {
        hasThinking = true;
        break;
      }
    }
  }

  if (!hasThinking) return messages;

  // Strip thinking content from assistant messages
  return messages.map(msg => {
    if (msg.role !== 'assistant' || typeof msg.content !== 'string') return msg;

    let cleaned = msg.content;
    // Remove <thinking>...</thinking> blocks
    cleaned = cleaned.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim();
    // Remove <reasoning>...</reasoning> blocks
    cleaned = cleaned.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '').trim();
    // Remove [thinking]...[/thinking] blocks
    cleaned = cleaned.replace(/\[thinking\][\s\S]*?\[\/thinking\]/gi, '').trim();
    // Remove ***Thinking:*** blocks (Deepseek format)
    cleaned = cleaned.replace(/\*\*\*Thinking:\*\*\*[\s\S]*?(?=\n\n|\*\*\*|$)/gi, '').trim();

    if (cleaned === msg.content) return msg;
    return { ...msg, content: cleaned };
  });
}

/**
 * Normalize messages for a specific provider.
 */
export function normalizeForProvider(messages: ChatMessage[], providerName: string): ChatMessage[] {
  const name = providerName.toLowerCase();

  // Cerebras and Groq don't support thinking blocks
  if (name === 'cerebras' || name === 'groq') {
    return stripThinkingBlocks(messages);
  }

  return messages;
}
