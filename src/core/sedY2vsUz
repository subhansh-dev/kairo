/**
 * Kairo — Turn Context
 * Per-turn setup for the agent loop.
 * Ported from Hermes Agent's turn_context.py
 */

import { IterationBudget } from './iteration-budget.js';

// ─── Types ──────────────────────────────────────────────────────

export interface TurnContext {
  turnId: string;
  startTime: number;
  budget: IterationBudget;
  toolCallCount: number;
  apiCallCount: number;
  interrupted: boolean;
  failed: boolean;
  lastError: string | null;
  retryCount: number;
  maxRetries: number;
}

// ─── Builder ────────────────────────────────────────────────────

export function buildTurnContext(maxIterations: number, maxRetries: number = 3): TurnContext {
  return {
    turnId: generateTurnId(),
    startTime: Date.now(),
    budget: new IterationBudget(maxIterations),
    toolCallCount: 0,
    apiCallCount: 0,
    interrupted: false,
    failed: false,
    lastError: null,
    retryCount: 0,
    maxRetries,
  };
}

function generateTurnId(): string {
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Check if the turn should continue.
 */
export function shouldContinueTurn(ctx: TurnContext): boolean {
  if (ctx.interrupted) return false;
  if (ctx.failed && ctx.retryCount >= ctx.maxRetries) return false;
  if (ctx.budget.exhausted) return false;
  return true;
}

/**
 * Record an API call.
 */
export function recordApiCall(ctx: TurnContext): void {
  ctx.apiCallCount++;
  ctx.budget.consume();
}

/**
 * Record a tool call.
 */
export function recordToolCall(ctx: TurnContext): void {
  ctx.toolCallCount++;
}

/**
 * Record an error and decide whether to retry.
 */
export function recordError(ctx: TurnContext, error: string): boolean {
  ctx.lastError = error;
  ctx.retryCount++;
  if (ctx.retryCount >= ctx.maxRetries) {
    ctx.failed = true;
    return false; // don't retry
  }
  return true; // retry
}

/**
 * Mark turn as interrupted.
 */
export function interruptTurn(ctx: TurnContext): void {
  ctx.interrupted = true;
}

/**
 * Get turn duration in milliseconds.
 */
export function getTurnDuration(ctx: TurnContext): number {
  return Date.now() - ctx.startTime;
}
