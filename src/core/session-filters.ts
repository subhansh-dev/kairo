/**
 * Session filters — filter and sort sessions.
 */

export interface SessionFilter {
  model?: string;
  provider?: string;
  after?: number;
  before?: number;
  hasToolCalls?: boolean;
  minMessages?: number;
  maxMessages?: number;
  search?: string;
}

export type SessionSort = 'newest' | 'oldest' | 'most_messages' | 'least_messages';

/**
 * Filter sessions based on criteria.
 */
export function filterSessions<T extends { model?: string; provider?: string; createdAt?: number; messages?: any[] }>(
  sessions: T[],
  filter: SessionFilter,
): T[] {
  return sessions.filter(session => {
    if (filter.model && session.model !== filter.model) return false;
    if (filter.provider && session.provider !== filter.provider) return false;
    if (filter.after && (session.createdAt || 0) < filter.after) return false;
    if (filter.before && (session.createdAt || 0) > filter.before) return false;
    if (filter.minMessages && (session.messages?.length || 0) < filter.minMessages) return false;
    if (filter.maxMessages && (session.messages?.length || 0) > filter.maxMessages) return false;
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      const content = session.messages?.map(m => m.content).join(' ').toLowerCase() || '';
      if (!content.includes(searchLower)) return false;
    }
    return true;
  });
}

/**
 * Sort sessions.
 */
export function sortSessions<T extends { createdAt?: number; messages?: any[] }>(
  sessions: T[],
  sort: SessionSort,
): T[] {
  const sorted = [...sessions];
  switch (sort) {
    case 'newest':
      return sorted.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    case 'oldest':
      return sorted.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    case 'most_messages':
      return sorted.sort((a, b) => (b.messages?.length || 0) - (a.messages?.length || 0));
    case 'least_messages':
      return sorted.sort((a, b) => (a.messages?.length || 0) - (b.messages?.length || 0));
    default:
      return sorted;
  }
}

/**
 * Get unique models from sessions.
 */
export function getUniqueModels(sessions: Array<{ model?: string }>): string[] {
  const models = new Set<string>();
  for (const s of sessions) {
    if (s.model) models.add(s.model);
  }
  return [...models].sort();
}

/**
 * Get unique providers from sessions.
 */
export function getUniqueProviders(sessions: Array<{ provider?: string }>): string[] {
  const providers = new Set<string>();
  for (const s of sessions) {
    if (s.provider) providers.add(s.provider);
  }
  return [...providers].sort();
}
