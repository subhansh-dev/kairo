/**
 * Trajectory compressor — compress conversation trajectories.
 */

export interface TrajectoryMessage {
  role: string;
  content: string;
  tool_calls?: unknown[];
  tool_call_id?: string;
}

/**
 * Compress a trajectory by removing redundant information.
 */
export function compressTrajectory(messages: TrajectoryMessage[], maxTokens: number): TrajectoryMessage[] {
  if (estimateTrajectoryTokens(messages) <= maxTokens) return messages;

  // Strategy 1: Remove tool results, keep only summaries
  const compressed: TrajectoryMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Summarize tool result
      const preview = msg.content.slice(0, 200);
      compressed.push({ ...msg, content: preview + (msg.content.length > 200 ? '… [compressed]' : '') });
    } else {
      compressed.push(msg);
    }
  }

  // If still too large, remove middle messages (keep first and last N)
  if (estimateTrajectoryTokens(compressed) > maxTokens) {
    const keepFirst = 3;
    const keepLast = 5;
    const truncated = [
      ...compressed.slice(0, keepFirst),
      { role: 'system', content: `[${compressed.length - keepFirst - keepLast} messages compressed]` },
      ...compressed.slice(-keepLast),
    ];
    return truncated;
  }

  return compressed;
}

/**
 * Estimate tokens in a trajectory.
 */
export function estimateTrajectoryTokens(messages: TrajectoryMessage[]): number {
  let totalChars = 0;
  for (const msg of messages) {
    totalChars += msg.content.length + 4;
    if (msg.tool_calls) totalChars += JSON.stringify(msg.tool_calls).length;
  }
  return Math.ceil(totalChars / 4);
}

/**
 * Convert scratchpad content to thinking format.
 */
export function convertScratchpadToThink(content: string): string {
  if (!content) return content;
  // If already in think tags, return as-is
  if (content.includes('<think>') || content.includes('<thinking>')) return content;
  return `<think>\n${content}\n</think>`;
}
