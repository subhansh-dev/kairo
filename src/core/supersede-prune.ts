/**
 * Kairo — Supersede Pruning
 * When the same file is read multiple times, older reads are superseded
 * by newer ones and can be pruned from context.
 * 
 * Example: if the model reads auth.ts at line 10, then later reads the
 * full file, the first read is superseded and can be replaced with a
 * placeholder. This saves significant context tokens during long sessions.
 */

// ─── Types ─────────────────────────────────────────────────

export interface SupersedeConfig {
  /** Also prune results flagged as useless by their tool */
  pruneUseless: boolean;
  /** Prune a candidate when all messages after it total at most this many tokens */
  suffixTokenLimit: number;
}

const DEFAULT_CONFIG: SupersedeConfig = {
  pruneUseless: true,
  suffixTokenLimit: 8000,
};

/** Placeholder written over a superseded tool result */
export const SUPERSEDED_NOTICE = '[Superseded by a newer read of this file]';

/** Placeholder written over an elided useless tool result */
export const USELESS_NOTICE = '[Uneventful result elided]';

// ─── Supersede Key ─────────────────────────────────────────

/**
 * Generate a supersede key for a tool call.
 * Results sharing a key form a group where every result except the newest
 * is a supersede candidate.
 */
export function getSupersedeKey(toolName: string, args: Record<string, unknown>): string | undefined {
  // File reads: group by path (selector-free supersedes selector-carrying)
  if (toolName === 'read' || toolName === 'file_read') {
    const path = typeof args.path === 'string' ? args.path : 
                 typeof args.file_path === 'string' ? args.file_path : undefined;
    if (path) {
      // Strip selector (e.g., "file.ts:50-100" → "file.ts")
      const base = path.split(':')[0];
      return `read:${base}`;
    }
  }

  // Search/grep: group by pattern + path
  if (toolName === 'grep' || toolName === 'search') {
    const pattern = typeof args.pattern === 'string' ? args.pattern : '';
    const path = typeof args.path === 'string' ? args.path : '';
    return `search:${pattern}:${path}`;
  }

  return undefined;
}

// ─── Pruning Logic ─────────────────────────────────────────

interface PrunableMessage {
  role: string;
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  supersedeKey?: string;
  isUseless?: boolean;
}

/**
 * Find and replace superseded tool results with placeholders.
 * Returns the number of messages pruned and estimated tokens saved.
 */
export function pruneSuperseded(
  messages: PrunableMessage[],
  config: SupersedeConfig = DEFAULT_CONFIG,
): { pruned: number; savedChars: number } {
  // Group messages by supersede key
  const groups = new Map<string, number[]>();
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'tool' && msg.role !== 'assistant') continue;
    
    const key = msg.supersedeKey || (msg.toolName ? getSupersedeKey(msg.toolName, msg.toolArgs || {}) : undefined);
    if (!key) continue;
    
    msg.supersedeKey = key;
    const group = groups.get(key) || [];
    group.push(i);
    groups.set(key, group);
  }

  // For each group, prune all but the newest
  let pruned = 0;
  let savedChars = 0;

  for (const [, indices] of groups) {
    if (indices.length < 2) continue;

    // Keep the last (newest), prune the rest
    for (let i = 0; i < indices.length - 1; i++) {
      const idx = indices[i];
      const msg = messages[idx];
      const originalLen = msg.content.length;

      // Replace with placeholder
      const notice = msg.isUseless && config.pruneUseless ? USELESS_NOTICE : SUPERSEDED_NOTICE;
      msg.content = notice;
      pruned++;
      savedChars += originalLen - notice.length;
    }
  }

  return { pruned, savedChars };
}
