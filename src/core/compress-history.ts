/**
 * Compress history — conversation history compression.
 */

export interface CompressionResult {
  originalCount: number;
  compressedCount: number;
  originalTokens: number;
  compressedTokens: number;
  strategy: string;
}

/**
 * Compress conversation history by removing redundant messages.
 */
export function compressHistory(messages: Array<{ role: string; content: string }>, maxTokens: number): {
  messages: Array<{ role: string; content: string }>;
  result: CompressionResult;
} {
  const originalTokens = estimateTokens(messages);

  if (originalTokens <= maxTokens) {
    return {
      messages,
      result: {
        originalCount: messages.length,
        compressedCount: messages.length,
        originalTokens,
        compressedTokens: originalTokens,
        strategy: 'none',
      },
    };
  }

  // Strategy 1: Truncate tool results
  let compressed = messages.map(m => {
    if (m.role === 'tool' && m.content.length > 500) {
      return { ...m, content: m.content.slice(0, 500) + '\n… [compressed]' };
    }
    return m;
  });

  if (estimateTokens(compressed) <= maxTokens) {
    return {
      messages: compressed,
      result: {
        originalCount: messages.length,
        compressedCount: compressed.length,
        originalTokens,
        compressedTokens: estimateTokens(compressed),
        strategy: 'truncate_tool_results',
      },
    };
  }

  // Strategy 2: Remove middle messages, keep first and last N
  const keepFirst = 3;
  const keepLast = 5;
  compressed = [
    ...messages.slice(0, keepFirst),
    { role: 'system', content: `[${messages.length - keepFirst - keepLast} messages compressed]` },
    ...messages.slice(-keepLast),
  ];

  return {
    messages: compressed,
    result: {
      originalCount: messages.length,
      compressedCount: compressed.length,
      originalTokens,
      compressedTokens: estimateTokens(compressed),
      strategy: 'drop_middle',
    },
  };
}

function estimateTokens(messages: Array<{ content: string }>): number {
  let total = 0;
  for (const m of messages) total += Math.ceil(m.content.length / 4) + 4;
  return total;
}
