/**
 * Compression feedback — user-facing summaries for compression commands.
 */

export interface CompressionFeedback {
  noop: boolean;
  aborted: boolean;
  fallbackUsed: boolean;
  headline: string;
  tokenLine: string;
  note: string | null;
}

/**
 * Generate user-facing feedback for a manual compression operation.
 */
export function summarizeManualCompression(opts: {
  beforeCount: number;
  afterCount: number;
  beforeTokens: number;
  afterTokens: number;
  aborted?: boolean;
  fallbackUsed?: boolean;
  failureReason?: string | null;
}): CompressionFeedback {
  const { beforeCount, afterCount, beforeTokens, afterTokens, aborted, fallbackUsed, failureReason } = opts;
  const noop = beforeCount === afterCount;

  let headline: string;
  if (aborted) {
    headline = `Compression aborted: ${beforeCount} messages preserved`;
  } else if (fallbackUsed) {
    headline = `Compressed with fallback: ${beforeCount} → ${afterCount} messages`;
  } else if (noop) {
    headline = `No changes from compression: ${beforeCount} messages`;
  } else {
    headline = `Compressed: ${beforeCount} → ${afterCount} messages`;
  }

  let tokenLine: string;
  if (noop && afterTokens === beforeTokens) {
    tokenLine = `Approx request size: ~${beforeTokens.toLocaleString()} tokens (unchanged)`;
  } else {
    tokenLine = `Approx request size: ~${beforeTokens.toLocaleString()} → ~${afterTokens.toLocaleString()} tokens`;
  }

  let note: string | null = null;
  if (aborted) {
    note = 'Summary generation failed; no messages were removed.';
  } else if (fallbackUsed) {
    const droppedCount = Math.max(beforeCount - afterCount, 0);
    note = `Summary generation failed; used limited fallback and removed ${droppedCount} message(s).`;
  } else if (!noop && afterCount < beforeCount && afterTokens > beforeTokens) {
    note = 'Note: fewer messages can still raise this estimate when compression rewrites the transcript into denser summaries.';
  }

  if (failureReason && (aborted || fallbackUsed)) {
    note = `${note} Reason: ${failureReason.trim()}`;
  }

  return { noop, aborted: Boolean(aborted), fallbackUsed: Boolean(fallbackUsed), headline, tokenLine, note };
}

/**
 * Format compression feedback for display.
 */
export function formatCompressionFeedback(feedback: CompressionFeedback): string {
  const parts = [feedback.headline, feedback.tokenLine];
  if (feedback.note) parts.push(feedback.note);
  return parts.join('\n');
}
