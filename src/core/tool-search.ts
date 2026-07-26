/**
 * Tool search — find tools by name or description.
 */

export interface ToolSearchResult {
  name: string;
  description: string;
  score: number;
}

/**
 * Search tools by query string.
 */
export function searchTools(
  query: string,
  tools: Array<{ name: string; description: string }>,
  limit = 5,
): ToolSearchResult[] {
  const lower = query.toLowerCase();
  const results: ToolSearchResult[] = [];

  for (const tool of tools) {
    let score = 0;
    const nameLower = tool.name.toLowerCase();
    const descLower = tool.description.toLowerCase();

    // Exact name match
    if (nameLower === lower) { score = 1.0; }
    // Name contains query
    else if (nameLower.includes(lower)) { score = 0.7 + (lower.length / nameLower.length) * 0.3; }
    // Description contains query
    else if (descLower.includes(lower)) { score = 0.3 + (lower.length / descLower.length) * 0.2; }
    // Fuzzy name match
    else {
      const words = lower.split(/\s+/);
      const matchedWords = words.filter(w => nameLower.includes(w) || descLower.includes(w));
      if (matchedWords.length > 0) {
        score = (matchedWords.length / words.length) * 0.4;
      }
    }

    if (score > 0) {
      results.push({ name: tool.name, description: tool.description, score });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Get tool suggestions based on user intent.
 */
export function getToolSuggestions(
  intent: string,
  tools: Array<{ name: string; description: string }>,
): string[] {
  const intentKeywords: Record<string, string[]> = {
    read: ['read', 'file', 'view', 'show', 'display', 'cat'],
    write: ['write', 'create', 'save', 'file'],
    edit: ['edit', 'modify', 'change', 'patch', 'update'],
    exec: ['run', 'execute', 'command', 'shell', 'terminal'],
    search: ['search', 'find', 'grep', 'look'],
    git: ['git', 'commit', 'branch', 'merge', 'diff'],
    web: ['web', 'url', 'fetch', 'download', 'http'],
  };

  const lower = intent.toLowerCase();
  for (const [tool, keywords] of Object.entries(intentKeywords)) {
    if (keywords.some(k => lower.includes(k))) {
      return [tool];
    }
  }

  // Fall back to search
  const results = searchTools(intent, tools, 3);
  return results.map(r => r.name);
}
