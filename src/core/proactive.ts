/**
 * Proactive — proactive suggestion utilities.
 */

export interface ProactiveSuggestion {
  id: string;
  type: 'optimization' | 'security' | 'performance' | 'quality' | 'documentation';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  actionable: boolean;
  action?: string;
}

// Tracked suggestions
const suggestions: ProactiveSuggestion[] = [];

/**
 * Add a proactive suggestion.
 */
export function addSuggestion(suggestion: Omit<ProactiveSuggestion, 'id'>): ProactiveSuggestion {
  const full: ProactiveSuggestion = {
    ...suggestion,
    id: `sug_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  };
  suggestions.push(full);
  return full;
}

/**
 * Get all suggestions.
 */
export function getSuggestions(type?: ProactiveSuggestion['type']): ProactiveSuggestion[] {
  if (type) return suggestions.filter(s => s.type === type);
  return [...suggestions];
}

/**
 * Get high-priority suggestions.
 */
export function getHighPrioritySuggestions(): ProactiveSuggestion[] {
  return suggestions.filter(s => s.priority === 'high');
}

/**
 * Clear suggestions.
 */
export function clearSuggestions(): void {
  suggestions.length = 0;
}

/**
 * Format suggestions for display.
 */
export function formatSuggestions(sugs: ProactiveSuggestion[]): string {
  if (sugs.length === 0) return 'No suggestions.';

  const priorityIcon = { high: '🔴', medium: '🟡', low: '🟢' };
  const typeIcon = { optimization: '⚡', security: '🔒', performance: '🚀', quality: '✨', documentation: '📝' };

  return sugs.map(s =>
    `${priorityIcon[s.priority]} ${typeIcon[s.type]} ${s.title}\n   ${s.description}${s.action ? `\n   → ${s.action}` : ''}`
  ).join('\n\n');
}
