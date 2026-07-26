/**
 * Intent — user intent detection.
 */

export type IntentType =
  | 'code_write'
  | 'code_read'
  | 'code_edit'
  | 'code_review'
  | 'search'
  | 'question'
  | 'task'
  | 'conversation'
  | 'system';

export interface DetectedIntent {
  type: IntentType;
  confidence: number;
  entities: string[];
  action?: string;
}

/**
 * Detect user intent from a message.
 */
export function detectIntent(message: string): DetectedIntent {
  const lower = message.toLowerCase();

  // Code write patterns
  if (/\b(?:write|create|add|implement|build|make|generate|scaffold)\b/.test(lower) &&
      /\b(?:function|class|component|module|file|api|endpoint|test)\b/.test(lower)) {
    return { type: 'code_write', confidence: 0.8, entities: extractCodeEntities(message) };
  }

  // Code read patterns
  if (/\b(?:read|show|display|view|see|look|check|examine|inspect)\b/.test(lower) &&
      /\b(?:file|code|function|class|component)\b/.test(lower)) {
    return { type: 'code_read', confidence: 0.8, entities: extractCodeEntities(message) };
  }

  // Code edit patterns
  if (/\b(?:edit|modify|change|update|fix|patch|refactor|rename)\b/.test(lower)) {
    return { type: 'code_edit', confidence: 0.7, entities: extractCodeEntities(message) };
  }

  // Code review patterns
  if (/\b(?:review|audit|check|analyze|inspect)\b/.test(lower) &&
      /\b(?:code|pr|pull request|changes|diff)\b/.test(lower)) {
    return { type: 'code_review', confidence: 0.8, entities: [] };
  }

  // Search patterns
  if (/\b(?:search|find|grep|look for|where is|locate)\b/.test(lower)) {
    return { type: 'search', confidence: 0.7, entities: extractSearchTerms(message) };
  }

  // Question patterns
  if (/\b(?:what|how|why|when|where|who|which|can you|could you|would you)\b/.test(lower) && message.includes('?')) {
    return { type: 'question', confidence: 0.6, entities: [] };
  }

  // Task patterns
  if (/\b(?:run|execute|start|stop|deploy|install|build|test|lint|format)\b/.test(lower)) {
    return { type: 'task', confidence: 0.7, entities: [] };
  }

  // Default to conversation
  return { type: 'conversation', confidence: 0.5, entities: [] };
}

function extractCodeEntities(message: string): string[] {
  const entities: string[] = [];
  // Extract file paths
  const fileMatches = message.match(/[\w/.-]+\.\w+/g);
  if (fileMatches) entities.push(...fileMatches);
  // Extract function/class names (camelCase or PascalCase)
  const nameMatches = message.match(/\b[a-z][a-zA-Z0-9]*\b/g);
  if (nameMatches) entities.push(...nameMatches.slice(0, 3));
  return [...new Set(entities)];
}

function extractSearchTerms(message: string): string[] {
  const stopWords = new Set(['search', 'find', 'grep', 'look', 'for', 'the', 'a', 'an', 'in', 'on', 'at', 'to', 'and', 'or', 'is', 'are', 'was', 'were']);
  return message.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w.toLowerCase())).slice(0, 5);
}

/**
 * Format detected intent for display.
 */
export function formatIntent(intent: DetectedIntent): string {
  const typeEmoji: Record<IntentType, string> = {
    code_write: '✏️', code_read: '📖', code_edit: '🔧', code_review: '🔍',
    search: '🔎', question: '❓', task: '⚡', conversation: '💬', system: '⚙️',
  };
  return `${typeEmoji[intent.type]} ${intent.type} (${Math.round(intent.confidence * 100)}%)`;
}
