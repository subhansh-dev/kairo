/**
 * Live session context-window breakdown for UI surfaces.
 *
 * Estimates how the next provider request is composed: system prompt,
 * tool schemas, conversation history, etc.
 */

export interface ContextBreakdown {
  systemPrompt: number;
  toolDefinitions: number;
  rules: number;
  skills: number;
  mcp: number;
  memory: number;
  conversation: number;
  total: number;
  maxContext: number;
  usagePercent: number;
}

/**
 * Estimate tokens from character count (rough: 1 token ≈ 4 chars).
 */
function charsToTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens from a JSON-serializable value.
 */
function jsonTokens(value: unknown): number {
  if (!value) return 0;
  return charsToTokens(JSON.stringify(value));
}

/**
 * Compute a context breakdown for the current session.
 */
export function computeContextBreakdown(opts: {
  systemPrompt?: string;
  tools?: unknown[];
  messages?: Array<{ role: string; content: unknown }>;
  maxContext?: number;
  skillsContent?: string;
  memoryContent?: string;
  rulesContent?: string;
}): ContextBreakdown {
  const {
    systemPrompt = '',
    tools = [],
    messages = [],
    maxContext = 128000,
    skillsContent = '',
    memoryContent = '',
    rulesContent = '',
  } = opts;

  const systemPromptTokens = charsToTokens(systemPrompt);
  const toolTokens = jsonTokens(tools);
  const skillsTokens = charsToTokens(skillsContent);
  const memoryTokens = charsToTokens(memoryContent);
  const rulesTokens = charsToTokens(rulesContent);

  // Estimate conversation tokens
  let conversationTokens = 0;
  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
    conversationTokens += charsToTokens(content) + 4; // +4 for role overhead
  }

  const total = systemPromptTokens + toolTokens + skillsTokens + memoryTokens + rulesTokens + conversationTokens;
  const usagePercent = Math.round((total / maxContext) * 100);

  return {
    systemPrompt: systemPromptTokens,
    toolDefinitions: toolTokens,
    rules: rulesTokens,
    skills: skillsTokens,
    mcp: 0, // MCP tools are included in toolDefinitions
    memory: memoryTokens,
    conversation: conversationTokens,
    total,
    maxContext,
    usagePercent,
  };
}

/**
 * Format a context breakdown for display.
 */
export function formatContextBreakdown(breakdown: ContextBreakdown): string {
  const parts = [
    `System: ${breakdown.systemPrompt.toLocaleString()}`,
    `Tools: ${breakdown.toolDefinitions.toLocaleString()}`,
    `Skills: ${breakdown.skills.toLocaleString()}`,
    `Memory: ${breakdown.memory.toLocaleString()}`,
    `Conversation: ${breakdown.conversation.toLocaleString()}`,
    `Rules: ${breakdown.rules.toLocaleString()}`,
  ];
  return `${parts.join(' | ')} — Total: ${breakdown.total.toLocaleString()}/${breakdown.maxContext.toLocaleString()} (${breakdown.usagePercent}%)`;
}

/**
 * Check if context is approaching the limit.
 */
export function isContextNearLimit(breakdown: ContextBreakdown, threshold = 80): boolean {
  return breakdown.usagePercent >= threshold;
}

/**
 * Get a warning message if context is near the limit.
 */
export function getContextWarning(breakdown: ContextBreakdown): string | null {
  if (breakdown.usagePercent >= 90) {
    return `⚠️ Context usage at ${breakdown.usagePercent}% — consider /compact`;
  }
  if (breakdown.usagePercent >= 80) {
    return `Context usage at ${breakdown.usagePercent}%`;
  }
  return null;
}
