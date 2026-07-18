/**
 * Summary management — stores and retrieves conversation summaries.
 */

export interface ConversationSummary {
  /** The summary text */
  text: string;
  /** Number of messages that were compacted */
  messageCount: number;
  /** Token count of the original messages */
  originalTokens: number;
  /** Token count of the summary */
  summaryTokens: number;
  /** When the summary was created */
  createdAt: Date;
  /** The model used for summarization */
  model?: string;
  /** Messages that were included in this summary range */
  startIndex: number;
  endIndex: number;
}

/**
 * Parse a summary from LLM output, extracting the <summary> tag content.
 */
export function parseSummaryFromOutput(output: string): string | null {
  // Try to extract from <summary> tags
  const tagMatch = output.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (tagMatch) {
    return tagMatch[1].trim();
  }

  // If no tags, use the whole output as the summary
  const trimmed = output.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }

  return null;
}

/**
 * Merge two summaries into one.
 */
export function mergeSummaries(
  older: ConversationSummary,
  newer: ConversationSummary,
): ConversationSummary {
  return {
    text: `${older.text}\n\n---\n\n${newer.text}`,
    messageCount: older.messageCount + newer.messageCount,
    originalTokens: older.originalTokens + newer.originalTokens,
    summaryTokens: estimateSummaryTokens(older.text + '\n\n' + newer.text),
    createdAt: new Date(),
    startIndex: older.startIndex,
    endIndex: newer.endIndex,
  };
}

/**
 * Truncate a summary to fit within a token budget.
 */
export function truncateSummary(
  summary: ConversationSummary,
  maxTokens: number,
): ConversationSummary {
  const estimated = estimateSummaryTokens(summary.text);
  if (estimated <= maxTokens) return summary;

  // Rough truncation: keep first N characters
  const ratio = maxTokens / estimated;
  const targetChars = Math.floor(summary.text.length * ratio * 0.9);
  const truncatedText = summary.text.slice(0, targetChars) + '\n\n[summary truncated]';

  return {
    ...summary,
    text: truncatedText,
    summaryTokens: estimateSummaryTokens(truncatedText),
  };
}

/**
 * Estimate token count for summary text.
 */
export function estimateSummaryTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Create a summary from raw output.
 */
export function createSummary(
  output: string,
  messageCount: number,
  originalTokens: number,
  startIndex: number,
  endIndex: number,
  model?: string,
): ConversationSummary | null {
  const text = parseSummaryFromOutput(output);
  if (!text) return null;

  return {
    text,
    messageCount,
    originalTokens,
    summaryTokens: estimateSummaryTokens(text),
    createdAt: new Date(),
    model,
    startIndex,
    endIndex,
  };
}
