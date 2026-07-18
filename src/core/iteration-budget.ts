/**
 * Kairo — Iteration Budget
 * Per-agent iteration budget — thread-safe consume/refund counter.
 * Ported from Hermes Agent's iteration_budget.py
 */

export class IterationBudget {
  private maxTotal: number;
  private used: number = 0;

  constructor(maxTotal: number) {
    this.maxTotal = maxTotal;
  }

  /** Try to consume one iteration. Returns true if allowed. */
  consume(): boolean {
    if (this.used >= this.maxTotal) return false;
    this.used++;
    return true;
  }

  /** Refund iterations (e.g., for programmatic tool calls). */
  refund(count: number = 1): void {
    this.used = Math.max(0, this.used - count);
  }

  /** Get remaining iterations. */
  get remaining(): number {
    return Math.max(0, this.maxTotal - this.used);
  }

  /** Check if budget is exhausted. */
  get exhausted(): boolean {
    return this.used >= this.maxTotal;
  }

  /** Reset the budget. */
  reset(): void {
    this.used = 0;
  }

  /** Get usage stats. */
  get stats(): { used: number; remaining: number; max: number } {
    return { used: this.used, remaining: this.remaining, max: this.maxTotal };
  }
}
