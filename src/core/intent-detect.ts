/**
 * Intent detect — advanced intent detection.
 */

export interface IntentResult {
  primary: string;
  secondary?: string;
  confidence: number;
  entities: Entity[];
  sentiment: 'positive' | 'negative' | 'neutral';
  urgency: 'low' | 'medium' | 'high';
}

export interface Entity {
  type: 'file' | 'function' | 'variable' | 'url' | 'path' | 'command';
  value: string;
  position: number;
}

/**
 * Detect intent with entity extraction.
 */
export function detectIntentAdvanced(message: string): IntentResult {
  const lower = message.toLowerCase();

  // Detect sentiment
  const positiveWords = ['good', 'great', 'awesome', 'perfect', 'love', 'nice', 'excellent', 'thanks', 'thank'];
  const negativeWords = ['bad', 'wrong', 'error', 'broken', 'fail', 'bug', 'issue', 'problem', 'hate'];
  const positive = positiveWords.some(w => lower.includes(w));
  const negative = negativeWords.some(w => lower.includes(w));
  const sentiment = positive && !negative ? 'positive' : negative && !positive ? 'negative' : 'neutral';

  // Detect urgency
  const urgentWords = ['urgent', 'asap', 'immediately', 'critical', 'emergency', 'now'];
  const urgency = urgentWords.some(w => lower.includes(w)) ? 'high' : lower.includes('when you can') ? 'low' : 'medium';

  // Extract entities
  const entities = extractEntities(message);

  // Detect primary intent
  let primary = 'conversation';
  let confidence = 0.5;
  let secondary: string | undefined;

  if (/\b(?:write|create|add|implement|build|make|generate)\b/.test(lower)) {
    primary = 'create';
    confidence = 0.8;
    if (/\btest\b/.test(lower)) secondary = 'testing';
  } else if (/\b(?:read|show|display|view|check|examine)\b/.test(lower)) {
    primary = 'read';
    confidence = 0.8;
  } else if (/\b(?:edit|modify|change|update|fix|patch|refactor)\b/.test(lower)) {
    primary = 'modify';
    confidence = 0.8;
  } else if (/\b(?:search|find|grep|look for|where)\b/.test(lower)) {
    primary = 'search';
    confidence = 0.7;
  } else if (/\b(?:run|execute|start|deploy|install|build|test)\b/.test(lower)) {
    primary = 'execute';
    confidence = 0.7;
  } else if (/\b(?:delete|remove|destroy|clean)\b/.test(lower)) {
    primary = 'delete';
    confidence = 0.7;
  } else if (message.includes('?')) {
    primary = 'question';
    confidence = 0.6;
  }

  return { primary, secondary, confidence, entities, sentiment, urgency };
}

function extractEntities(message: string): Entity[] {
  const entities: Entity[] = [];

  // File paths
  const fileMatches = message.matchAll(/(?:\/[\w.-]+)+\.\w+/g);
  for (const match of fileMatches) {
    entities.push({ type: 'file', value: match[0], position: match.index! });
  }

  // URLs
  const urlMatches = message.matchAll(/https?:\/\/[^\s<>"]+/g);
  for (const match of urlMatches) {
    entities.push({ type: 'url', value: match[0], position: match.index! });
  }

  // Commands
  const cmdMatches = message.matchAll(/\b(?:npm|yarn|pnpm|git|docker|cargo|pip)\s+\w+/g);
  for (const match of cmdMatches) {
    entities.push({ type: 'command', value: match[0], position: match.index! });
  }

  return entities.sort((a, b) => a.position - b.position);
}

/**
 * Format intent result for display.
 */
export function formatIntentResult(result: IntentResult): string {
  const sentimentEmoji = { positive: '😊', negative: '😟', neutral: '😐' };
  const urgencyEmoji = { low: '🟢', medium: '🟡', high: '🔴' };
  return `${sentimentEmoji[result.sentiment]} ${urgencyEmoji[result.urgency]} ${result.primary}${result.secondary ? `/${result.secondary}` : ''} (${Math.round(result.confidence * 100)}%)`;
}
