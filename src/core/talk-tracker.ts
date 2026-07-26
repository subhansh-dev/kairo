/**
 * Talk tracker — track talk/conversation topics.
 */

export interface TalkTopic {
  id: string;
  title: string;
  keywords: string[];
  mentionedAt: number;
  messageCount: number;
}

// Tracked topics
const topics = new Map<string, TalkTopic>();

/**
 * Record a topic mention.
 */
export function recordTopic(title: string, keywords: string[] = []): void {
  const id = title.toLowerCase().replace(/[^a-z0-9]/g, '_');
  const existing = topics.get(id);
  if (existing) {
    existing.messageCount++;
    existing.mentionedAt = Date.now();
    // Merge new keywords
    for (const kw of keywords) {
      if (!existing.keywords.includes(kw)) existing.keywords.push(kw);
    }
  } else {
    topics.set(id, {
      id,
      title,
      keywords,
      mentionedAt: Date.now(),
      messageCount: 1,
    });
  }
}

/**
 * Get all tracked topics.
 */
export function getTopics(): TalkTopic[] {
  return [...topics.values()].sort((a, b) => b.mentionedAt - a.mentionedAt);
}

/**
 * Get recent topics.
 */
export function getRecentTopics(limit = 10): TalkTopic[] {
  return getTopics().slice(0, limit);
}

/**
 * Search topics by keyword.
 */
export function searchTopics(query: string): TalkTopic[] {
  const lower = query.toLowerCase();
  return [...topics.values()].filter(t =>
    t.title.toLowerCase().includes(lower) || t.keywords.some(k => k.toLowerCase().includes(lower))
  );
}

/**
 * Clear topic history.
 */
export function clearTopics(): void {
  topics.clear();
}
