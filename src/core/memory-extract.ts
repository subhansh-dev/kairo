/**
 * Kairo — Proactive Memory Extraction
 * Automatically extracts important decisions, patterns, and learnings
 * from conversations. Stores them for future reference.
 * 
 */

export interface MemoryEntry {
  id: string;
  type: 'decision' | 'pattern' | 'error' | 'preference' | 'fact';
  content: string;
  context: string; // where this was learned
  confidence: number; // 0-1
  timestamp: number;
  source: 'auto' | 'manual';
}

const memories: MemoryEntry[] = [];
const MAX_MEMORIES = 500;

// ─── Extraction Patterns ──────────────────────────────────

const DECISION_PATTERNS = [
  /(?:decided|chose|picked|going with|using|selected|will use)\s+(.{10,100})/gi,
  /(?:let's|let me|I'll)\s+(use|go with|pick|choose)\s+(.{5,80})/gi,
  /(?:the best approach|the right way|better to)\s+(.{10,100})/gi,
];

const ERROR_PATTERNS = [
  /(?:error|bug|issue|problem|fail|broken|crash)[:\s]+(.{10,150})/gi,
  /(?:doesn't work|not working|failed to|can't)\s+(.{10,100})/gi,
  /(?:fixed|resolved|solved|patched)\s+(.{10,100})/gi,
];

const PATTERN_PATTERNS = [
  /(?:pattern|convention|standard|practice|norm)[:\s]+(.{10,150})/gi,
  /(?:always|never|don't|should|must)\s+(.{10,100})/gi,
  /(?:in this project|here we|the codebase)\s+(.{10,100})/gi,
];

const PREFERENCE_PATTERNS = [
  /(?:prefer|like|want|need|favorite)\s+(.{10,100})/gi,
  /(?:don't like|hate|avoid|skip)\s+(.{10,100})/gi,
];

/**
 * Extract memories from a conversation message.
 */
export function extractMemories(
  role: string,
  content: string,
  context: string = '',
): MemoryEntry[] {
  if (role !== 'assistant' && role !== 'user') return [];
  if (content.length < 50) return []; // Too short to extract from

  const extracted: MemoryEntry[] = [];

  // Extract decisions
  for (const pattern of DECISION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const text = match[1]?.trim();
      if (text && text.length > 10) {
        extracted.push({
          id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'decision',
          content: text,
          context: context.slice(0, 200),
          confidence: 0.7,
          timestamp: Date.now(),
          source: 'auto',
        });
      }
    }
  }

  // Extract errors and fixes
  for (const pattern of ERROR_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const text = match[1]?.trim();
      if (text && text.length > 10) {
        extracted.push({
          id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'error',
          content: text,
          context: context.slice(0, 200),
          confidence: 0.8,
          timestamp: Date.now(),
          source: 'auto',
        });
      }
    }
  }

  // Extract patterns
  for (const pattern of PATTERN_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const text = match[1]?.trim();
      if (text && text.length > 10) {
        extracted.push({
          id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'pattern',
          content: text,
          context: context.slice(0, 200),
          confidence: 0.6,
          timestamp: Date.now(),
          source: 'auto',
        });
      }
    }
  }

  // Deduplicate by content similarity
  const unique: MemoryEntry[] = [];
  for (const mem of extracted) {
    const isDuplicate = memories.some(existing =>
      existing.content.toLowerCase().includes(mem.content.toLowerCase().slice(0, 30)) ||
      mem.content.toLowerCase().includes(existing.content.toLowerCase().slice(0, 30))
    );
    if (!isDuplicate) unique.push(mem);
  }

  return unique.slice(0, 5); // Max 5 per message
}

/**
 * Store extracted memories.
 */
export function storeMemories(entries: MemoryEntry[]): void {
  memories.push(...entries);

  // Evict oldest if at capacity
  if (memories.length > MAX_MEMORIES) {
    // Keep highest confidence memories
    memories.sort((a, b) => b.confidence - a.confidence);
    memories.length = MAX_MEMORIES;
  }
}

/**
 * Search memories by query.
 */
export function searchMemories(query: string, limit: number = 10): MemoryEntry[] {
  const lower = query.toLowerCase();
  return memories
    .filter(m => m.content.toLowerCase().includes(lower))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}

/**
 * Get memories by type.
 */
export function getMemoriesByType(type: MemoryEntry['type'], limit: number = 20): MemoryEntry[] {
  return memories
    .filter(m => m.type === type)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

/**
 * Format memories for context injection.
 */
export function formatMemoriesForContext(query?: string, limit: number = 5): string {
  const relevant = query
    ? searchMemories(query, limit)
    : memories.sort((a, b) => b.confidence - a.confidence).slice(0, limit);

  if (relevant.length === 0) return '';

  const lines = relevant.map(m =>
    `[${m.type}] ${m.content}${m.confidence < 0.7 ? ' (low confidence)' : ''}`
  );

  return `\n\n# Relevant Memories\n${lines.join('\n')}`;
}

/**
 * Get memory stats.
 */
export function getMemoryStats(): { total: number; byType: Record<string, number> } {
  const byType: Record<string, number> = {};
  for (const m of memories) {
    byType[m.type] = (byType[m.type] || 0) + 1;
  }
  return { total: memories.length, byType };
}

/**
 * Clear all memories.
 */
export function clearMemories(): void {
  memories.length = 0;
}
