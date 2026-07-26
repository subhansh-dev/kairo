/**
 * Kairo — Tool Result Cache
 * Caches read results to avoid re-reading the same files.
 * Invalidates on file change (via content hash).
 * Huge speedup for multi-step workflows that reference the same files.
 */

import { createHash } from 'crypto';

interface CacheEntry {
  key: string;
  result: string;
  contentHash: string;
  timestamp: number;
  hits: number;
}

const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 200;
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Get a cached result if available and fresh.
 */
export function getCached(toolName: string, args: string): string | null {
  const key = `${toolName}:${args}`;
  const entry = cache.get(key);
  if (!entry) return null;

  // Check age
  if (Date.now() - entry.timestamp > MAX_AGE_MS) {
    cache.delete(key);
    return null;
  }

  entry.hits++;
  return entry.result;
}

/**
 * Store a result in the cache.
 */
export function setCached(toolName: string, args: string, result: string, content?: string): void {
  // Evict oldest if at capacity
  if (cache.size >= MAX_ENTRIES) {
    const oldest = [...cache.entries()]
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, 20);
    for (const [k] of oldest) cache.delete(k);
  }

  const key = `${toolName}:${args}`;
  cache.set(key, {
    key,
    result,
    contentHash: content ? hashContent(content) : '',
    timestamp: Date.now(),
    hits: 0,
  });
}

/**
 * Invalidate cache entries for a specific file path.
 * Called when write/edit tools modify a file.
 */
export function invalidateFile(filePath: string): void {
  for (const [key, entry] of cache) {
    if (key.includes(filePath)) {
      cache.delete(key);
    }
  }
}

/**
 * Get cache stats for status display.
 */
export function getCacheStats(): { size: number; hits: number; missRate: number } {
  let totalHits = 0;
  for (const entry of cache.values()) {
    totalHits += entry.hits;
  }
  return {
    size: cache.size,
    hits: totalHits,
    missRate: cache.size > 0 ? 1 - totalHits / (cache.size + totalHits) : 0,
  };
}

/**
 * Clear the entire cache.
 */
export function clearCache(): void {
  cache.clear();
}
