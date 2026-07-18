/**
 * Kairo — Turn Finalizer
 * Post-loop turn finalization.
 * Ported from Hermes Agent's turn_finalizer.py
 *
 * Runs after the main tool-calling loop: budget check, trajectory save,
 * session persist, diagnostics, response transforms, memory/skill review trigger.
 */

import { IterationBudget } from './iteration-budget.js';

// ─── Types ──────────────────────────────────────────────────────

export interface TurnResult {
  response: string;
  interrupted: boolean;
  failed: boolean;
  budgetExhausted: boolean;
  toolCalls: number;
  durationMs: number;
  tokensUsed: number;
  shouldReviewMemory: boolean;
  shouldReviewSkills: boolean;
}

export interface TurnFinalizerConfig {
  maxIterations: number;
  autoReviewMemory: boolean;
  autoReviewSkills: boolean;
  reviewAfterNTurns: number;
}

const DEFAULT_CONFIG: TurnFinalizerConfig = {
  maxIterations: 30,
  autoReviewMemory: true,
  autoReviewSkills: true,
  reviewAfterNTurns: 5,
};

// ─── Finalizer ──────────────────────────────────────────────────

export function finalizeTurn(options: {
  response: string;
  apiCallCount: number;
  interrupted: boolean;
  failed: boolean;
  budget: IterationBudget;
  toolCallCount: number;
  startTime: number;
  tokensUsed: number;
  turnNumber: number;
  config?: Partial<TurnFinalizerConfig>;
}): TurnResult {
  const cfg = { ...DEFAULT_CONFIG, ...options.config };
  const {
    response,
    apiCallCount,
    interrupted,
    failed,
    budget,
    toolCallCount,
    startTime,
    tokensUsed,
    turnNumber,
  } = options;

  const budgetExhausted = apiCallCount >= cfg.maxIterations || budget.remaining <= 0;
  const durationMs = Date.now() - startTime;

  // Determine if we should trigger memory/skill review
  const shouldReviewMemory = cfg.autoReviewMemory && turnNumber % cfg.reviewAfterNTurns === 0;
  const shouldReviewSkills = cfg.autoReviewSkills && turnNumber % (cfg.reviewAfterNTurns * 2) === 0;

  return {
    response,
    interrupted,
    failed,
    budgetExhausted,
    toolCalls: toolCallCount,
    durationMs,
    tokensUsed,
    shouldReviewMemory,
    shouldReviewSkills,
  };
}

// ─── Response Transforms ────────────────────────────────────────

/**
 * Apply post-processing transforms to the agent's response.
 */
export function transformResponse(response: string, context: {
  isCoding: boolean;
  hasToolCalls: boolean;
}): string {
  let result = response;

  // Remove thinking blocks from final response
  result = result.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();

  // Remove incomplete tool calls from final response
  result = result.replace(/!([a-z_]+)\s*\n?$/gm, '').trim();

  return result;
}

// ─── Diagnostics ────────────────────────────────────────────────

export function formatTurnDiagnostics(result: TurnResult): string {
  const parts: string[] = [];
  parts.push(`Duration: ${(result.durationMs / 1000).toFixed(1)}s`);
  parts.push(`Tools: ${result.toolCalls}`);
  parts.push(`Tokens: ${result.tokensUsed}`);
  if (result.budgetExhausted) parts.push('Budget exhausted');
  if (result.interrupted) parts.push('Interrupted');
  if (result.failed) parts.push('Failed');
  return parts.join(' | ');
}
