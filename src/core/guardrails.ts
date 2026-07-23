/**
 * Kairo — Tool Call Guardrails (Unified)
 * Dangerous action detection, failure classification, idempotent-no-progress detection,
 * hash-based signature tracking, and threat pattern assessment.
 *
 * This file is the canonical source for all guardrail primitives.
 * The duplicate `tool-guardrails.ts` has been merged into this file.
 */

import { createHash } from 'crypto';

// ─── Config ────────────────────────────────────────────────

export interface GuardrailConfig {
  maxConsecutiveFailures: number;
  maxSameToolFailures: number;
  maxIdempotentTurns: number;
  blockDangerousCommands: boolean;
  blockPathTraversal: boolean;
  blockSecretExposure: boolean;
  warningsEnabled: boolean;
  hardStopEnabled: boolean;
  exactFailureWarnAfter: number;
  exactFailureBlockAfter: number;
  sameToolFailureWarnAfter: number;
  sameToolFailureHaltAfter: number;
  noProgressWarnAfter: number;
  noProgressBlockAfter: number;
}

const DEFAULT_CONFIG: GuardrailConfig = {
  maxConsecutiveFailures: 3,
  maxSameToolFailures: 2,
  maxIdempotentTurns: 4,
  blockDangerousCommands: true,
  blockPathTraversal: true,
  blockSecretExposure: true,
  warningsEnabled: true,
  hardStopEnabled: false,
  exactFailureWarnAfter: 2,
  exactFailureBlockAfter: 5,
  sameToolFailureWarnAfter: 3,
  sameToolFailureHaltAfter: 8,
  noProgressWarnAfter: 2,
  noProgressBlockAfter: 5,
};

// ─── Idempotent & Mutating Tool Sets ────────────────────

/** Tools that are safe to repeat (reads, searches) */
export const IDEMPOTENT_TOOL_NAMES = new Set([
  'read', 'grep', 'glob', 'ls', 'web_fetch', 'web_search', 'session_search',
]);

/** Tools that mutate state */
export const MUTATING_TOOL_NAMES = new Set([
  'exec', 'write', 'edit', 'git', 'todo', 'memory', 'skill',
]);

// ─── Hardline Patterns (unconditionally blocked) ──────────

const HARDLINE_PATTERNS: RegExp[] = [
  /rm\s+-[a-z]*rf?\s+\//,
  /:\(\)\s*\{/,
  /mkfs\s+\/dev\//,
  /dd\s+if=\/dev\/zero\s+of=\/dev\//,
  /chmod\s+-R?\s*777\s+\//,
  /chown\s+-R?\s+\//,
  />\s*\/dev\/sda/,
  /shutdown\s+-h\s+now/,
  /(?:^|&&|\|\||;|\|)\s*(?:sudo\s+)?reboot\b/m,
  /(?:^|&&|\|\||;|\|)\s*(?:sudo\s+)?halt\b/m,
  /poweroff/,
  /init\s+0/,
  /init\s+6/,
];

// ─── Failure Classification ───────────────────────────────

export type FailureClass = 'transient' | 'permanent' | 'rate_limit' | 'auth' | 'timeout' | 'parse' | 'unknown';

export function classifyToolFailure(error: string): FailureClass {
  const lower = error.toLowerCase();

  if (/rate.?limit|429|too many requests/.test(lower)) return 'rate_limit';
  if (/timeout|timed? ?out|etimedout/.test(lower)) return 'timeout';
  if (/401|403|unauthorized|forbidden|invalid.*key|auth/.test(lower)) return 'auth';
  if (/parse|syntax|invalid json|unexpected token/.test(lower)) return 'parse';
  if (/not found|enoent|eacces|eperm/.test(lower)) return 'permanent';

  // Transient errors
  if (/5\d\d|internal|unavailable|retry|busy|overloaded/.test(lower)) return 'transient';

  return 'unknown';
}

// ─── Hash-Based Signature Tracking ───────────────────

/** Canonicalize tool args for hashing (sorted keys, stable serialization). */
export function canonicalToolArgs(args: Record<string, unknown>): string {
  return JSON.stringify(args, Object.keys(args).sort());
}

/** Create a stable hash of tool args. */
export function hashToolArgs(args: Record<string, unknown>): string {
  return createHash('sha256').update(canonicalToolArgs(args)).digest('hex').slice(0, 12);
}

export interface ToolCallSignature {
  toolName: string;
  argsHash: string;
}

export function createSignature(toolName: string, args: Record<string, unknown>): ToolCallSignature {
  return { toolName, argsHash: hashToolArgs(args) }; 
}

export type GuardrailAction = 'allow' | 'warn' | 'block' | 'halt';

export interface ToolGuardrailDecision {
  action: GuardrailAction;
  code: string;
  message: string;
}

interface TurnObservation {
  signature: ToolCallSignature;
  success: boolean;
  timestamp: number;
}

// ─── Tool Call Guardrail Controller (Unified) ───────────────

export interface GuardrailState {
  consecutiveFailures: number;
  sameToolFailures: Map<string, number>;
  lastToolName: string | null;
  idempotentTurns: number;
  lastOutput: string | null;
  blocklisted: boolean;
  observations: TurnObservation[];
  noProgressRuns: number;
}

export class GuardrailController {
  private state: GuardrailState = {
    consecutiveFailures: 0,
    sameToolFailures: new Map(),
    lastToolName: null,
    idempotentTurns: 0,
    lastOutput: null,
    blocklisted: false,
    observations: [],
    noProgressRuns: 0,
  };
  private config: GuardrailConfig;

  constructor(config: Partial<GuardrailConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a tool call is hardline blocked (dangerous)
   */
  checkHardline(command: string): { blocked: boolean; reason?: string } {
    if (!this.config.blockDangerousCommands) return { blocked: false };
    // Also check threat patterns for enhanced blocking
    const threat = assessCommandThreat(command);
    if (threat.isThreat && threat.matches.some(m => m.severity === 'block')) {
      return { blocked: true, reason: `Blocked by threat pattern: ${threat.matches[0].label}` };
    }

    for (const pattern of HARDLINE_PATTERNS) {
      if (pattern.test(command)) {
        return { blocked: true, reason: `Hardline blocked: matches dangerous pattern` };
      }
    }

    return { blocked: false };
  }

  /**
   * Record a tool result and detect loops.
   * Also tracks hash-based signatures for idempotent no-progress detection.
   */
  recordResult(toolName: string, success: boolean, output: string, args?: Record<string, unknown>): { stuck: boolean; reason?: string; action?: GuardrailAction } {
    // Track observation for hash-based detection
    if (args) {
      const sig = createSignature(toolName, args);
      this.state.observations.push({ signature: sig, success, timestamp: Date.now() });
    }

    if (!success) {
      this.state.consecutiveFailures++;

      const failures = (this.state.sameToolFailures.get(toolName) || 0) + 1;
      this.state.sameToolFailures.set(toolName, failures);

      if (this.state.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        return { stuck: true, reason: `${this.config.maxConsecutiveFailures}+ consecutive failures` };
      }
      // Check same-tool failure warn
      if (this.config.warningsEnabled && failures >= this.config.sameToolFailureWarnAfter) {
        // Log warning but don't stop
      }
      if (failures >= this.config.maxSameToolFailures) {
        return { stuck: true, reason: `"${toolName}" failed ${failures}+ times` };
      }
    } else {
      this.state.consecutiveFailures = 0;
    }

    // Idempotent no-progress detection (output-based)
    const normalized = output.slice(0, 200);
    if (this.state.lastOutput !== null && this.state.lastOutput === normalized) {
      this.state.idempotentTurns++;
      this.state.noProgressRuns++;
      if (this.state.idempotentTurns >= this.config.maxIdempotentTurns) {
        return { stuck: true, reason: 'Idempotent output detected — no progress' };
      }
    } else {
      this.state.idempotentTurns = 0;
      this.state.noProgressRuns = 0;
    }

    // Hash-based idempotent check (even on success)
    if (args && IDEMPOTENT_TOOL_NAMES.has(toolName)) {
      const sig = createSignature(toolName, args);
      const recentSame = this.state.observations
        .filter(o => o.signature.toolName === toolName && o.signature.argsHash === sig.argsHash)
        .length;
      if (recentSame > 1) {
        this.state.noProgressRuns++;
        if (this.config.warningsEnabled && this.state.noProgressRuns >= this.config.noProgressWarnAfter) {
          // Warning logged but not blocking
        }
      }
    }

    this.state.lastOutput = normalized;
    this.state.lastToolName = toolName;

    return { stuck: false };
  }

  /**
   * Check if tool call is path traversal
   */
  checkPathTraversal(filePath: string): boolean {
    if (!this.config.blockPathTraversal) return false;
    return filePath.includes('../') || filePath.includes('..\\');
  }

  /**
   * Reset guardrail state
   */
  reset(): void {
    this.state = {
      consecutiveFailures: 0,
      sameToolFailures: new Map(),
      lastToolName: null,
      idempotentTurns: 0,
      lastOutput: null,
      blocklisted: false,
      observations: [],
      noProgressRuns: 0,
    };
  }

  /**
   * Alias for reset() — backward compatibility with ToolCallGuardrailController.
   * Resets guardrail state for a new turn.
   */
  resetForTurn(): void {
    this.reset();
  }

  /**
   * Get current state summary
   */
  getSummary(): string {
    const total = this.state.observations.length;
    const failures = this.state.observations.filter(o => !o.success).length;
    const lines: string[] = [`Tool calls: ${total}, failures: ${failures}, no-progress: ${this.state.noProgressRuns}`];
    if (this.state.consecutiveFailures > 0) lines.push(`Consecutive failures: ${this.state.consecutiveFailures}`);
    if (this.state.idempotentTurns > 0) lines.push(`Idempotent turns: ${this.state.idempotentTurns}`);
    if (this.state.sameToolFailures.size > 0) {
      const fails = [...this.state.sameToolFailures.entries()]
        .filter(([, c]) => c >= 2)
        .map(([t, c]) => `${t} (${c}x)`);
      if (fails.length > 0) lines.push(`Repeated failures: ${fails.join(', ')}`);
    }
    return lines.join('\n');
  }
}


export const THREAT_PATTERNS: Array<{ pattern: RegExp; label: string; severity: 'block' | 'warn' | 'flag' }> = [
  { pattern: /\beval\s*\(/, label: 'Dynamic eval', severity: 'warn' },
  { pattern: /\bexec\s*\(/, label: 'Exec replacement', severity: 'warn' },
  { pattern: /(?:wget|curl)\s+.*\|/, label: 'Pipe from network', severity: 'warn' },
  { pattern: /base64\s+-d.*\|/, label: 'Base64 decode pipe', severity: 'warn' },
  { pattern: /chown\s+-R\s/, label: 'Recursive chown', severity: 'warn' },
  { pattern: /IFS\s*=/, label: 'IFS manipulation', severity: 'warn' },
  { pattern: /PATH\s*=/, label: 'PATH manipulation', severity: 'warn' },
];

export interface ThreatAssessment {
  isThreat: boolean;
  matches: Array<{ pattern: string; label: string; severity: 'block' | 'warn' | 'flag' }>;
}

export function assessCommandThreat(command: string): ThreatAssessment {
  const matches = THREAT_PATTERNS
    .filter(t => t.pattern.test(command))
    .map(t => ({ pattern: t.pattern.source, label: t.label, severity: t.severity }));

  return {
    isThreat: matches.length > 0,
    matches,
  };
}
