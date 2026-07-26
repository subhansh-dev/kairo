/**
 * Context inspect — inspect context state.
 */

export interface ContextInspectResult {
  messageCount: number;
  estimatedTokens: number;
  systemPromptTokens: number;
  toolTokens: number;
  conversationTokens: number;
  maxTokens: number;
  usagePercent: number;
  recentMessages: Array<{ role: string; preview: string }>;
}

/**
 * Inspect the current context state.
 */
export function inspectContext(opts: {
  messages: Array<{ role: string; content: unknown }>;
  systemPrompt?: string;
  tools?: unknown[];
  maxTokens?: number;
}): ContextInspectResult {
  const maxTokens = opts.maxTokens || 128000;

  // Estimate tokens
  const systemPromptTokens = estimateTokens(opts.systemPrompt || '');
  const toolTokens = opts.tools ? estimateTokens(JSON.stringify(opts.tools)) : 0;
  let conversationTokens = 0;
  for (const msg of opts.messages) {
    const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
    conversationTokens += estimateTokens(content) + 4;
  }

  const estimatedTokens = systemPromptTokens + toolTokens + conversationTokens;
  const usagePercent = Math.round((estimatedTokens / maxTokens) * 100);

  // Get recent messages preview
  const recentMessages = opts.messages.slice(-5).map(m => ({
    role: m.role,
    preview: typeof m.content === 'string'
      ? m.content.slice(0, 100).replace(/\n/g, ' ')
      : '[complex content]',
  }));

  return {
    messageCount: opts.messages.length,
    estimatedTokens,
    systemPromptTokens,
    toolTokens,
    conversationTokens,
    maxTokens,
    usagePercent,
    recentMessages,
  };
}

/**
 * Format context inspection for display.
 */
export function formatContextInspect(result: ContextInspectResult): string {
  const lines = [
    `Messages: ${result.messageCount}`,
    `Tokens: ~${result.estimatedTokens.toLocaleString()} / ${result.maxTokens.toLocaleString()} (${result.usagePercent}%)`,
    `  System: ${result.systemPromptTokens.toLocaleString()}`,
    `  Tools: ${result.toolTokens.toLocaleString()}`,
    `  Conversation: ${result.conversationTokens.toLocaleString()}`,
  ];

  if (result.recentMessages.length > 0) {
    lines.push('', 'Recent:');
    for (const msg of result.recentMessages) {
      lines.push(`  [${msg.role}] ${msg.preview}`);
    }
  }

  return lines.join('\n');
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
