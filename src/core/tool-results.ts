/**
 * Kairo — Tool Result Management
 * Result persistence, turn budget enforcement, oversized result handling
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const RESULTS_DIR = join(homedir(), '.kairo', 'tool-results');

// ─── Budget Config ────────────────────────────────────────

interface ToolResultBudget {
  /** Max chars per individual tool result */
  maxResultLength: number;
  /** Max chars for ALL tool results in one turn */
  maxTurnBudget: number;
  /** Threshold in chars above which results are written to file */
  persistThreshold: number;
  /** Whether to truncate oversized results */
  truncateOversized: boolean;
}

const DEFAULT_BUDGET: ToolResultBudget = {
  maxResultLength: 10_000,
  maxTurnBudget: 50_000,
  persistThreshold: 5_000,
  truncateOversized: true,
};

let currentBudget: ToolResultBudget = { ...DEFAULT_BUDGET };

export function setResultBudget(budget: Partial<ToolResultBudget>): void {
  currentBudget = { ...currentBudget, ...budget };
}

export function getResultBudget(): ToolResultBudget {
  return { ...currentBudget };
}

// ─── Result Storage ───────────────────────────────────────

function ensureResultsDir(): void {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
}

/**
 * Persist a large tool result to disk, returning a reference string
 */
export function maybePersistResult(toolName: string, output: string): string {
  if (output.length <= currentBudget.persistThreshold) return output;

  ensureResultsDir();
  const id = `${toolName}_${Date.now().toString(36)}`;
  const filePath = join(RESULTS_DIR, `${id}.json`);

  writeFileSync(filePath, JSON.stringify({
    tool: toolName,
    timestamp: Date.now(),
    length: output.length,
    content: output,
  }, null, 2));

  return `[Large result: ${output.length} chars — persisted to ${filePath}]`;
}

/**
 * Format tool result respecting budget limits
 */
export function formatResult(toolName: string, output: string, turnBudget: { used: number }): string {
  let result = output;

  // Truncate oversized individual results
  if (currentBudget.truncateOversized && result.length > currentBudget.maxResultLength) {
    result = result.slice(0, currentBudget.maxResultLength) +
      `\n... [truncated at ${currentBudget.maxResultLength} chars]`;
  }

  // Persist oversized results
  if (result.length > currentBudget.persistThreshold) {
    result = maybePersistResult(toolName, result);
  }

  return result;
}

// ─── Turn Budget Enforcement ──────────────────────────────

export class TurnBudgetManager {
  private usedChars: number = 0;
  private toolResults: Array<{ tool: string; chars: number }> = [];
  private isOversized: boolean = false;
  private overflowMessage: string = '';

  /**
   * Check if adding this result would exceed the turn budget
   */
  canAddResult(size: number): boolean {
    if (this.isOversized) return false;
    if (this.usedChars + size > currentBudget.maxTurnBudget) {
      this.isOversized = true;
      this.overflowMessage = `Turn budget exceeded (${this.usedChars + size} > ${currentBudget.maxTurnBudget} chars). ` +
        `Tool results will be truncated.`;
      return false;
    }
    return true;
  }

  /**
   * Record a tool result for budget tracking
   */
  addResult(tool: string, result: string): void {
    this.usedChars += result.length;
    this.toolResults.push({ tool, chars: result.length });
  }

  /**
   * Get current budget usage summary
   */
  getSummary(): string {
    const pct = ((this.usedChars / currentBudget.maxTurnBudget) * 100).toFixed(1);
    const lines = [`Tool results: ${this.usedChars.toLocaleString()} / ${currentBudget.maxTurnBudget.toLocaleString()} chars (${pct}%)`];
    for (const r of this.toolResults) {
      lines.push(`  ${r.tool}: ${r.chars.toLocaleString()} chars`);
    }
    if (this.overflowMessage) lines.push(this.overflowMessage);
    return lines.join('\n');
  }

  /**
   * Get overflow warning message
   */
  getOverflowWarning(): string {
    return this.overflowMessage;
  }

  /**
   * Reset for a new turn
   */
  reset(): void {
    this.usedChars = 0;
    this.toolResults = [];
    this.isOversized = false;
    this.overflowMessage = '';
  }
}
