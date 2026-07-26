/**
 * Budget configuration — tool call budget management.
 */

export interface BudgetConfig {
  maxToolCallsPerTurn: number;
  maxToolCallsTotal: number;
  maxTokensPerToolCall: number;
  maxTotalTokens: number;
  maxDurationMs: number;
  warnAtPercent: number;
  blockAtPercent: number;
}

const DEFAULT_BUDGET: BudgetConfig = {
  maxToolCallsPerTurn: 20,
  maxToolCallsTotal: 100,
  maxTokensPerToolCall: 50_000,
  maxTotalTokens: 500_000,
  maxDurationMs: 300_000, // 5 minutes
  warnAtPercent: 80,
  blockAtPercent: 95,
};

export interface BudgetState {
  toolCallsThisTurn: number;
  toolCallsTotal: number;
  tokensUsed: number;
  startTime: number;
}

/**
 * Create a fresh budget state.
 */
export function createBudgetState(): BudgetState {
  return {
    toolCallsThisTurn: 0,
    toolCallsTotal: 0,
    tokensUsed: 0,
    startTime: Date.now(),
  };
}

/**
 * Check if a tool call is within budget.
 */
export function checkBudget(state: BudgetState, config: BudgetConfig = DEFAULT_BUDGET): {
  allowed: boolean;
  reason?: string;
  warning?: string;
} {
  // Check per-turn limit
  if (state.toolCallsThisTurn >= config.maxToolCallsPerTurn) {
    return { allowed: false, reason: `Turn budget exhausted (${state.toolCallsThisTurn}/${config.maxToolCallsPerTurn} tool calls)` };
  }

  // Check total limit
  if (state.toolCallsTotal >= config.maxToolCallsTotal) {
    return { allowed: false, reason: `Total budget exhausted (${state.toolCallsTotal}/${config.maxToolCallsTotal} tool calls)` };
  }

  // Check duration
  const elapsed = Date.now() - state.startTime;
  if (elapsed >= config.maxDurationMs) {
    return { allowed: false, reason: `Time budget exhausted (${(elapsed / 1000).toFixed(0)}s / ${(config.maxDurationMs / 1000).toFixed(0)}s)` };
  }

  // Check token limit
  if (state.tokensUsed >= config.maxTotalTokens) {
    return { allowed: false, reason: `Token budget exhausted (${state.tokensUsed}/${config.maxTotalTokens})` };
  }

  // Warning thresholds
  const callPercent = (state.toolCallsThisTurn / config.maxToolCallsPerTurn) * 100;
  if (callPercent >= config.warnAtPercent) {
    return { allowed: true, warning: `Approaching turn budget (${state.toolCallsThisTurn}/${config.maxToolCallsPerTurn})` };
  }

  return { allowed: true };
}

/**
 * Record a tool call in the budget state.
 */
export function recordToolCall(state: BudgetState, tokenCount?: number): void {
  state.toolCallsThisTurn++;
  state.toolCallsTotal++;
  if (tokenCount) state.tokensUsed += tokenCount;
}

/**
 * Reset per-turn budget state.
 */
export function resetTurnBudget(state: BudgetState): void {
  state.toolCallsThisTurn = 0;
}

/**
 * Format budget state for display.
 */
export function formatBudget(state: BudgetState, config: BudgetConfig = DEFAULT_BUDGET): string {
  const elapsed = ((Date.now() - state.startTime) / 1000).toFixed(0);
  return `${state.toolCallsThisTurn}/${config.maxToolCallsPerTurn} tools | ${state.toolCallsTotal} total | ${elapsed}s`;
}
