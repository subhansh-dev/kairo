/**
 * Kairo — Token Utilities (Kairo-native rewrite)
 *
 * Token estimation and budget management.
 */

// ─── Token Estimation ────────────────────────────────────────────

/**
 * Estimate token count from text
 * Uses character-based estimation: ~4 chars per token for English
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(Buffer.byteLength(text, 'utf-8') / 4)
}

/**
 * Estimate token count from messages
 */
export function estimateMessageTokens(messages: Array<{ role: string; content: string | unknown }>): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    return sum + estimateTokens(content) + 4 // +4 for role overhead
  }, 0)
}

// ─── Token Budget ────────────────────────────────────────────────

export interface TokenBudget {
  total: number
  used: number
  remaining: number
  percentUsed: number
}

/**
 * Create a token budget
 */
export function createTokenBudget(total: number): TokenBudget {
  return {
    total,
    used: 0,
    remaining: total,
    percentUsed: 0,
  }
}

/**
 * Update token budget after usage
 */
export function useTokens(budget: TokenBudget, tokens: number): TokenBudget {
  const used = budget.used + tokens
  return {
    ...budget,
    used,
    remaining: Math.max(0, budget.total - used),
    percentUsed: Math.min(100, (used / budget.total) * 100),
  }
}

/**
 * Check if budget has enough tokens
 */
export function hasEnoughTokens(budget: TokenBudget, needed: number): boolean {
  return budget.remaining >= needed
}

/**
 * Get budget status string
 */
export function formatBudget(budget: TokenBudget): string {
  return `${budget.used.toLocaleString()} / ${budget.total.toLocaleString()} tokens (${budget.percentUsed.toFixed(1)}% used)`
}

// ─── Context Window ──────────────────────────────────────────────

/**
 * Get context window size for common models
 */
export function getContextWindow(model: string): number {
  const windows: Record<string, number> = {
    'nemotron-3-ultra': 1000000,
    'gpt-oss-120b': 131072,
    'gpt-oss-20b': 131072,
    'llama-3.3-70b': 128000,
  }

  // Check for partial matches
  for (const [key, value] of Object.entries(windows)) {
    if (model.toLowerCase().includes(key.toLowerCase())) {
      return value
    }
  }

  // Default
  return 128000
}

/**
 * Calculate available tokens for response
 */
export function getAvailableResponseTokens(
  contextWindow: number,
  usedTokens: number,
  reservePercent: number = 0.1,
): number {
  const available = contextWindow - usedTokens
  const reserved = Math.floor(contextWindow * reservePercent)
  return Math.max(0, available - reserved)
}
