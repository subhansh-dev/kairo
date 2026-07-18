/**
 * Pure tool-call loop guardrail primitives.
 *
 * Tracks per-turn tool-call observations and returns decisions.
 * Runtime code owns whether those decisions become warnings or controlled halts.
 */

import { createHash } from 'crypto';

// Tools that are safe to repeat (reads, searches)
export const IDEMPOTENT_TOOL_NAMES = new Set([
  'read', 'grep', 'glob', 'ls', 'web_fetch', 'web_search', 'session_search',
]);

// Tools that mutate state
export const MUTATING_TOOL_NAMES = new Set([
  'exec', 'write', 'edit', 'git', 'todo', 'memory', 'skill',
]);

export interface ToolCallGuardrailConfig {
  warningsEnabled: boolean;
  hardStopEnabled: boolean;
  exactFailureWarnAfter: number;
  exactFailureBlockAfter: number;
  sameToolFailureWarnAfter: number;
  sameToolFailureHaltAfter: number;
  noProgressWarnAfter: number;
  noProgressBlockAfter: number;
}

const DEFAULT_CONFIG: ToolCallGuardrailConfig = {
  warningsEnabled: true,
  hardStopEnabled: false,
  exactFailureWarnAfter: 2,
  exactFailureBlockAfter: 5,
  sameToolFailureWarnAfter: 3,
  sameToolFailureHaltAfter: 8,
  noProgressWarnAfter: 2,
  noProgressBlockAfter: 5,
};

export interface ToolCallSignature {
  toolName: string;
  argsHash: string;
}

export type GuardrailAction = 'allow' | 'warn' | 'block' | 'halt';

export interface ToolGuardrailDecision {
  action: GuardrailAction;
  code: string;
  message: string;
}

/**
 * Canonicalize tool args for hashing (sorted keys, stable serialization).
 */
export function canonicalToolArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, Object.keys(args).sort());
}

/**
 * Create a stable hash of tool args.
 */
export function hashToolArgs(args: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalToolArgs(args)).digest('hex').slice(0, 12);
}

/**
 * Create a tool call signature.
 */
export function createSignature(toolName: string, args: Record<string, unknown>): ToolCallSignature {
  return { toolName, argsHash: hashToolArgs(args) };
}

interface TurnObservation {
  signature: ToolCallSignature;
  success: boolean;
  timestamp: number;
}

/**
 * Per-turn tool-call guardrail controller.
 */
export class ToolCallGuardrailController {
  private config: ToolCallGuardrailConfig;
  private observations: TurnObservation[] = [];
  private consecutiveFailures = 0;
  private sameToolFailures = new Map<string, number>();
  private noProgressRuns = 0;

  constructor(config: Partial<ToolCallGuardrailConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Reset state for a new turn.
   */
  resetForTurn(): void {
    this.observations = [];
    this.consecutiveFailures = 0;
    this.sameToolFailures.clear();
    this.noProgressRuns = 0;
  }

  /**
   * Record a tool call observation and return a decision.
   */
  record(toolName: string, args: Record<string, unknown>, success: boolean): ToolGuardrailDecision {
    const sig = createSignature(toolName, args);
    this.observations.push({ signature: sig, success, timestamp: Date.now() });

    if (!success) {
      this.consecutiveFailures++;
      const count = (this.sameToolFailures.get(toolName) || 0) + 1;
      this.sameToolFailures.set(toolName, count);

      // Check same-tool failure halt
      if (this.config.hardStopEnabled && count >= this.config.sameToolFailureHaltAfter) {
        return {
          action: 'halt',
          code: 'same_tool_failure_halt',
          message: `Tool "${toolName}" failed ${count} times — halting to prevent infinite loop.`,
        };
      }

      // Check same-tool failure warn
      if (this.config.warningsEnabled && count >= this.config.sameToolFailureWarnAfter) {
        return {
          action: 'warn',
          code: 'same_tool_failure_warn',
          message: `Tool "${toolName}" has failed ${count} times in this turn.`,
        };
      }

      // Check exact failure block
      if (this.config.hardStopEnabled && this.consecutiveFailures >= this.config.exactFailureBlockAfter) {
        return {
          action: 'block',
          code: 'exact_failure_block',
          message: `${this.consecutiveFailures} consecutive failures — blocking further tool calls.`,
        };
      }

      // Check exact failure warn
      if (this.config.warningsEnabled && this.consecutiveFailures >= this.config.exactFailureWarnAfter) {
        return {
          action: 'warn',
          code: 'exact_failure_warn',
          message: `${this.consecutiveFailures} consecutive failures.`,
        };
      }
    } else {
      this.consecutiveFailures = 0;
    }

    // Check for idempotent no-progress (same read repeated without changes)
    if (IDEMPOTENT_TOOL_NAMES.has(toolName)) {
      const recentSame = this.observations
        .filter(o => o.signature.toolName === toolName && o.signature.argsHash === sig.argsHash)
        .length;
      if (recentSame > 1) {
        this.noProgressRuns++;
        if (this.config.hardStopEnabled && this.noProgressRuns >= this.config.noProgressBlockAfter) {
          return {
            action: 'block',
            code: 'no_progress_block',
            message: `Repeated identical ${toolName} calls with no progress.`,
          };
        }
        if (this.config.warningsEnabled && this.noProgressRuns >= this.config.noProgressWarnAfter) {
          return {
            action: 'warn',
            code: 'no_progress_warn',
            message: `Repeated identical ${toolName} calls — are you stuck?`,
          };
        }
      }
    }

    return { action: 'allow', code: 'allow', message: '' };
  }

  /**
   * Get a summary of the current turn's guardrail state.
   */
  getSummary(): string {
    const total = this.observations.length;
    const failures = this.observations.filter(o => !o.success).length;
    return `${total} tool calls, ${failures} failures, ${this.noProgressRuns} no-progress`;
  }
}
