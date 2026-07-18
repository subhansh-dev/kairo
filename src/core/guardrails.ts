/**
 * Kairo — Tool Call Guardrails
 * Dangerous action detection, failure classification, idempotent-no-progress detection
 */

// ─── Config ────────────────────────────────────────────────

export interface GuardrailConfig {
  maxConsecutiveFailures: number;
  maxSameToolFailures: number;
  maxIdempotentTurns: number;
  blockDangerousCommands: boolean;
  blockPathTraversal: boolean;
  blockSecretExposure: boolean;
}

const DEFAULT_CONFIG: GuardrailConfig = {
  maxConsecutiveFailures: 3,
  maxSameToolFailures: 2,
  maxIdempotentTurns: 4,
  blockDangerousCommands: true,
  blockPathTraversal: true,
  blockSecretExposure: true,
};

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
  /reboot/,
  /halt/,
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

// ─── Tool Call Guardrail Controller ───────────────────────

export interface GuardrailState {
  consecutiveFailures: number;
  sameToolFailures: Map<string, number>;
  lastToolName: string | null;
  idempotentTurns: number;
  lastOutput: string | null;
  blocklisted: boolean;
}

export class GuardrailController {
  private state: GuardrailState = {
    consecutiveFailures: 0,
    sameToolFailures: new Map(),
    lastToolName: null,
    idempotentTurns: 0,
    lastOutput: null,
    blocklisted: false,
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

    for (const pattern of HARDLINE_PATTERNS) {
      if (pattern.test(command)) {
        return { blocked: true, reason: `Hardline blocked: matches dangerous pattern` };
      }
    }

    return { blocked: false };
  }

  /**
   * Record a tool result and detect loops
   */
  recordResult(toolName: string, success: boolean, output: string): { stuck: boolean; reason?: string } {
    if (!success) {
      this.state.consecutiveFailures++;

      const failures = (this.state.sameToolFailures.get(toolName) || 0) + 1;
      this.state.sameToolFailures.set(toolName, failures);

      if (this.state.consecutiveFailures >= this.config.maxConsecutiveFailures) {
        return { stuck: true, reason: `${this.config.maxConsecutiveFailures}+ consecutive failures` };
      }
      if (failures >= this.config.maxSameToolFailures) {
        return { stuck: true, reason: `"${toolName}" failed ${failures}+ times` };
      }
    } else {
      this.state.consecutiveFailures = 0;
    }

    // Idempotent no-progress detection
    const normalized = output.slice(0, 200);
    if (this.state.lastOutput !== null && this.state.lastOutput === normalized) {
      this.state.idempotentTurns++;
      if (this.state.idempotentTurns >= this.config.maxIdempotentTurns) {
        return { stuck: true, reason: 'Idempotent output detected — no progress' };
      }
    } else {
      this.state.idempotentTurns = 0;
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
    };
  }

  /**
   * Get current state summary
   */
  getSummary(): string {
    const lines: string[] = [];
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
  { pattern: /rm\s+-[a-z]*rf\s+\//, label: 'rm -rf /', severity: 'block' },
  { pattern: /mkfs\s+\/dev\//, label: 'Format system disk', severity: 'block' },
  { pattern: /dd\s+if=\/dev\/zero\s+of=\/dev\//, label: 'Overwrite system disk', severity: 'block' },
  { pattern: /shutdown|reboot|halt|poweroff/, label: 'System shutdown', severity: 'block' },
  { pattern: /chmod\s+-R?\s*777\s+\//, label: 'World-writable root', severity: 'block' },
  { pattern: /:\(\)\s*\{/, label: 'Fork bomb', severity: 'block' },
  { pattern: />\s*\/dev\/sda/, label: 'Direct disk write', severity: 'block' },
  { pattern: /wget|curl\s+.*\|/, label: 'Pipe from network', severity: 'warn' },
  { pattern: /eval\s+/, label: 'Dynamic eval', severity: 'warn' },
  { pattern: /exec\s+/, label: 'Exec replacement', severity: 'warn' },
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
