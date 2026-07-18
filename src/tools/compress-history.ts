/**
 * Kairo — Tiered Tool History Compression
 * Compresses old tool results with tiered compression:
 * - Full: recent results (within keepRecentTokens)
 * - Mid-tier: older results truncated to 2K chars (preserves shape)
 * - Stub: oldest results replaced with "[Tool: X, Y chars — compressed]"
 *
 * Scales with context window size. Complements shake compaction.
 */

import type { ChatMessage } from '../providers/registry.js';

// ─── Constants ─────────────────────────────────────────────

/** Mid-tier: keep this many chars of old tool results */
const MID_MAX_CHARS = 2_000;

/** Stub args budget */
const STUB_ARGS_MAX_CHARS = 200;

/** How many recent messages to keep at full quality */
const DEFAULT_KEEP_RECENT = 20;

// ─── Compression ───────────────────────────────────────────

interface CompressionResult {
  messages: ChatMessage[];
  compressed: number;
  savedChars: number;
}

/**
 * Compress tool history with tiered compression.
 * Recent messages stay full quality, older ones get progressively compressed.
 */
export function compressToolHistory(
  messages: ChatMessage[],
  keepRecent: number = DEFAULT_KEEP_RECENT,
): CompressionResult {
  if (messages.length <= keepRecent) {
    return { messages, compressed: 0, savedChars: 0 };
  }

  const result: ChatMessage[] = [];
  let compressed = 0;
  let savedChars = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const content = contentStr(msg.content);

    if (i >= messages.length - keepRecent) {
      // Recent — keep full
      result.push(msg);
      continue;
    }

    // Check if this is a tool result worth compressing
    if (isToolResult(content)) {
      const compressed_content = compressToolResult(content);
      if (compressed_content !== content) {
        savedChars += content.length - compressed_content.length;
        compressed++;
        result.push({ ...msg, content: compressed_content });
        continue;
      }
    }

    result.push(msg);
  }

  return { messages: result, compressed, savedChars };
}

// ─── Helpers ───────────────────────────────────────────────

function contentStr(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === 'string') return content;
  return content.map(b => b.text || '').join('\n');
}

function isToolResult(content: string): boolean {
  return /^Tool \w+:/.test(content) || /Tool result:/.test(content);
}

/**
 * Compress a single tool result.
 * - If short enough: keep as-is (mid-tier)
 * - If too long: truncate to mid-tier size with notice
 * - If very long: replace with stub
 */
function compressToolResult(content: string): string {
  const len = content.length;

  // Short enough for mid-tier
  if (len <= MID_MAX_CHARS) return content;

  // Extract tool name for stub
  const toolMatch = content.match(/^Tool (\w+):/);
  const toolName = toolMatch ? toolMatch[1] : 'unknown';

  // Very long → stub
  if (len > MID_MAX_CHARS * 5) {
    return `Tool ${toolName}: [${len.toLocaleString()} chars — compressed to stub. Use the tool again to see full output.]`;
  }

  // Medium long → mid-tier (keep first N chars + notice)
  const header = toolMatch ? toolMatch[0] + '\n' : '';
  const body = toolMatch ? content.slice(header.length) : content;
  const keepChars = MID_MAX_CHARS - header.length - 100;
  const truncated = body.slice(0, keepChars);

  return header + truncated + `\n\n[... ${((body.length - keepChars) / 1000).toFixed(0)}K more chars — compressed. Original: ${len.toLocaleString()} chars]`;
}
