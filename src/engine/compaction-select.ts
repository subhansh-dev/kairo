// ─── Types ─────────────────────────────────────────────────

export interface CompactionItem {
  role: 'user' | 'assistant' | 'tool' | 'system' | 'developer';
  text?: string;
  hasToolRequests?: boolean;
  isCompactionSummary?: boolean;
}

export interface SplitPlan {
  /** Compact items at indices 0..splitIdx. Keep splitIdx..total. */
  splitIdx: number;
  /** Sum of itemTokenCounts[..splitIdx] */
  tokensToCompact: number;
}

// ─── Algorithm ─────────────────────────────────────────────

/**
 * Decide where to split items for compaction.
 *
 * Algorithm:
 * 1. Walk backward from newest, accumulating "keep" tokens.
 * 2. Candidate split = first index where adding more exceeds target.
 * 3. Snap forward to safe boundary (don't orphan tool results).
 * 4. Return None if compactable region is below minCompactable.
 *
 * @param itemTokenCounts - Token count per item
 * @param items - The conversation items
 * @param targetTokens - Target token budget for kept items
 * @param minCompactable - Minimum tokens to make compaction worth it
 * @returns Split plan, or null if nothing to compact
 */
export function selectTurnsToCompact(
  itemTokenCounts: number[],
  items: CompactionItem[],
  targetTokens: number,
  minCompactable: number,
): SplitPlan | null {
  if (itemTokenCounts.length !== items.length) {
    throw new Error('token counts and items must have the same length');
  }

  const total = items.length;
  if (total === 0) return null;

  // Step 1: Walk backward, sum "keep" tokens until target is reached.
  let kept = 0;
  let splitIdx = total; // start with "compact nothing"

  for (let i = total - 1; i >= 0; i--) {
    const count = itemTokenCounts[i];
    if (kept + count > targetTokens) {
      splitIdx = i + 1;
      break;
    }
    kept += count;
    splitIdx = i;
  }

  // If the whole list fits within budget, nothing to compact.
  if (splitIdx === 0) return null;

  // Step 2: Snap the split forward to a safe boundary.
  const safeSplitIdx = snapToSafeBoundary(items, splitIdx);

  // After snapping forward we might have eaten everything.
  if (safeSplitIdx >= total) return null;

  // Step 3: Compute tokens to compact and check minimum.
  let tokensToCompact = 0;
  for (let i = 0; i < safeSplitIdx; i++) {
    tokensToCompact += itemTokenCounts[i];
  }

  if (tokensToCompact < minCompactable) return null;

  return { splitIdx: safeSplitIdx, tokensToCompact };
}

/**
 * If `candidate` lands on a tool-result item, advance forward past all
 * tool-result items in the same tool-pair run.
 *
 * Ensures split lands before an assistant, user, system, or developer item —
 * never between an assistant-with-tool-requests and its tool results.
 */
function snapToSafeBoundary(items: CompactionItem[], candidate: number): number {
  const total = items.length;
  if (candidate >= total) return total;

  // If candidate is not a tool-result item, no snap needed.
  if (items[candidate].role !== 'tool') return candidate;

  // Candidate is a tool-result item. Find the run of contiguous tool-result
  // items and advance to just past the last one.
  let idx = candidate;
  while (idx < total && items[idx].role === 'tool') {
    idx++;
  }
  return idx;
}

// ─── Token Counting Helper ─────────────────────────────────

/**
 * Estimate token count for a message (rough approximation).
 * For production use, replace with a real tokenizer.
 */
export function estimateTokens(text: string): number {
  // Rough: ~4 chars per token for English text
  return Math.ceil(text.length / 4);
}

/**
 * Compute token counts for a list of conversation items.
 */
export function computeTokenCounts(items: CompactionItem[]): number[] {
  return items.map(item => {
    if (item.text) return estimateTokens(item.text);
    return 4; // minimal overhead for non-text items
  });
}
