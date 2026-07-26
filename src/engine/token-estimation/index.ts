/**
 * Token estimation — approximate token counting for various content types.
 */

/**
 * Estimate tokens for plain text (~4 chars per token).
 */
export function estimateTextTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a code block.
 */
export function estimateCodeTokens(code: string): number {
  if (!code) return 0;
  // Code tends to have slightly more tokens per char due to symbols
  return Math.ceil(code.length / 3.5);
}

/**
 * Estimate tokens for JSON content.
 */
export function estimateJsonTokens(json: string): number {
  if (!json) return 0;
  // JSON has lots of structural tokens (braces, quotes, colons)
  return Math.ceil(json.length / 3);
}

/**
 * Estimate tokens for a message (role + content).
 */
export function estimateMessageTokens(message: {
  role: string;
  content?: string;
  toolCalls?: Array<{ function: { name: string; arguments: string } }>;
}): number {
  let tokens = 4; // Base overhead for role/formatting

  if (message.content) {
    tokens += estimateTextTokens(message.content);
  }

  if (message.toolCalls) {
    for (const tc of message.toolCalls) {
      tokens += estimateTextTokens(tc.function.name);
      tokens += estimateJsonTokens(tc.function.arguments);
      tokens += 10; // Tool call overhead
    }
  }

  return tokens;
}

/**
 * Estimate tokens for a conversation.
 */
export function estimateConversationTokens(
  messages: Array<{ role: string; content?: string; toolCalls?: Array<{ function: { name: string; arguments: string } }> }>,
): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

/**
 * Estimate tokens for a system prompt.
 */
export function estimateSystemPromptTokens(prompt: string): number {
  return estimateTextTokens(prompt);
}

/**
 * Get a human-readable token count.
 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}
