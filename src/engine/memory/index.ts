/**
 * Cross-session memory — stores and retrieves information across sessions.
 */

export interface MemoryEntry {
  id: string;
  content: string;
  category: string;
  tags: string[];
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
  relevance: number;
}

export interface MemoryConfig {
  maxEntries: number;
  maxAgeDays: number;
  embeddingDimensions: number;
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  maxEntries: 1000,
  maxAgeDays: 90,
  embeddingDimensions: 384,
};

/**
 * Create a memory entry.
 */
export function createMemoryEntry(
  content: string,
  category: string = 'general',
  tags: string[] = [],
): MemoryEntry {
  return {
    id: crypto.randomUUID(),
    content,
    category,
    tags,
    createdAt: new Date(),
    lastAccessed: new Date(),
    accessCount: 0,
    relevance: 1.0,
  };
}

/**
 * Search memory by keyword matching.
 */
export function searchMemory(
  entries: MemoryEntry[],
  query: string,
  limit: number = 10,
): MemoryEntry[] {
  const q = query.toLowerCase();
  const scored = entries
    .map(e => ({
      entry: e,
      score: computeRelevanceScore(e, q),
    }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(s => ({
    ...s.entry,
    lastAccessed: new Date(),
    accessCount: s.entry.accessCount + 1,
    relevance: s.score,
  }));
}

function computeRelevanceScore(entry: MemoryEntry, query: string): number {
  let score = 0;

  // Exact content match
  if (entry.content.toLowerCase().includes(query)) score += 10;

  // Tag match
  for (const tag of entry.tags) {
    if (tag.toLowerCase().includes(query)) score += 5;
  }

  // Category match
  if (entry.category.toLowerCase().includes(query)) score += 3;

  // Recency bonus
  const ageMs = Date.now() - entry.createdAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  score += Math.max(0, 1 - ageDays / 90);

  // Access frequency bonus
  score += Math.min(entry.accessCount * 0.1, 2);

  return score;
}

/**
 * Evict old entries that exceed the max age.
 */
export function evictOldEntries(
  entries: MemoryEntry[],
  maxAgeDays: number = DEFAULT_MEMORY_CONFIG.maxAgeDays,
): MemoryEntry[] {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return entries.filter(e => e.createdAt.getTime() > cutoff);
}

/**
 * Merge similar memory entries.
 */
export function mergeSimilarEntries(
  entries: MemoryEntry[],
  similarityThreshold: number = 0.8,
): MemoryEntry[] {
  // Simple deduplication by content prefix
  const seen = new Map<string, MemoryEntry>();

  for (const entry of entries) {
    const key = entry.content.slice(0, 100).toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, entry);
    } else {
      // Merge: keep the one with higher access count
      if (entry.accessCount > existing.accessCount) {
        seen.set(key, entry);
      }
    }
  }

  return [...seen.values()];
}
