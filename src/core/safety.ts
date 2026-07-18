/**
 * Kairo — Safety Systems
 */

// ─── Tool Failure Loop Guard ──────────────────

interface FailureRecord {
  tool: string;
  error: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
}

const failureMap = new Map<string, FailureRecord>();
const MAX_CONSECUTIVE_FAILURES = 3;
const FAILURE_RESET_ON_SUCCESS = true;
const MAX_FAILURE_ENTRIES = 200;

function failureKey(tool: string, error: string): string {
  // Normalize error to detect same error pattern
  const normalized = error.replace(/\d+/g, 'N').replace(/[a-f0-9-]{36}/g, 'UUID');
  return `${tool}:${normalized.slice(0, 100)}`;
}

/**
 * Record a tool failure. Returns true if the agent is stuck in a loop.
 */
export function recordToolFailure(tool: string, error: string): boolean {
  const key = failureKey(tool, error);
  const existing = failureMap.get(key);

  if (existing) {
    existing.count++;
    existing.lastSeen = Date.now();
    return existing.count >= MAX_CONSECUTIVE_FAILURES;
  }

  // Evict oldest entries if at capacity
  if (failureMap.size >= MAX_FAILURE_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of failureMap) {
      if (now - v.lastSeen > 120_000) failureMap.delete(k);
    }
    // If still at capacity, remove oldest by lastSeen
    if (failureMap.size >= MAX_FAILURE_ENTRIES) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of failureMap) {
        if (v.lastSeen < oldestTime) { oldestTime = v.lastSeen; oldestKey = k; }
      }
      if (oldestKey) failureMap.delete(oldestKey);
    }
  }

  failureMap.set(key, {
    tool,
    error,
    count: 1,
    firstSeen: Date.now(),
    lastSeen: Date.now(),
  });

  return false;
}

/**
 * Record a tool success (resets failure count for that tool)
 */
export function recordToolSuccess(tool: string): void {
  if (!FAILURE_RESET_ON_SUCCESS) return;

  // Clear all failures for this tool
  for (const [key, record] of failureMap) {
    if (record.tool === tool) {
      failureMap.delete(key);
    }
  }
}

/**
 * Check if agent is stuck
 */
export function isStuck(): { stuck: boolean; tool?: string; error?: string; count?: number } {
  for (const [, record] of failureMap) {
    if (record.count >= MAX_CONSECUTIVE_FAILURES) {
      return {
        stuck: true,
        tool: record.tool,
        error: record.error,
        count: record.count,
      };
    }
  }
  return { stuck: false };
}

/**
 * Get failure summary
 */
export function getFailureSummary(): string {
  const failures = Array.from(failureMap.values()).filter(f => f.count >= 2);
  if (failures.length === 0) return '';

  return 'Recent repeated failures:\n' +
    failures.map(f => `  ${f.tool}: ${f.error.slice(0, 60)} (×${f.count})`).join('\n');
}

/**
 * Reset failure tracking
 */
export function resetFailures(): void {
  failureMap.clear();
}

// ─── Stop Hook System ─────────────────────────

type StopHook = (context: { messages: number; tokens: number }) => Promise<string | null>;

const stopHooks: StopHook[] = [];

/**
 * Register a stop hook
 */
export function registerStopHook(hook: StopHook): void {
  stopHooks.push(hook);
}

/**
 * Run all stop hooks. Returns messages to inject, or null.
 */
export async function runStopHooks(context: { messages: number; tokens: number }): Promise<string | null> {
  const results: string[] = [];

  for (const hook of stopHooks) {
    try {
      const result = await hook(context);
      if (result) results.push(result);
    } catch {
      // Don't fail on hook errors
    }
  }

  return results.length > 0 ? results.join('\n') : null;
}

// ─── Auto-thinking Classifier ──────────────────

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Classify prompt complexity to auto-select thinking level
 * Uses heuristics (no LLM call needed)
 */
export function classifyThinkingLevel(prompt: string): ThinkingLevel {
  const lower = prompt.toLowerCase();
  const len = prompt.length;
  const wordCount = prompt.split(/\s+/).filter(Boolean).length;

  // Quick/simple prompts
  if (len < 30 && /^(hi|hello|hey|thanks|ok|yes|no|what|who|when)\b/.test(lower)) {
    return 'off';
  }

  // Simple questions (short, no code indicators)
  if (len < 80 && !/[{}();=]/.test(prompt) && !/```/.test(prompt) && wordCount < 15) {
    return 'minimal';
  }

  // Code-related signals
  const codeSignals = ['implement', 'function', 'class', 'debug', 'fix', 'refactor', 'write', 'create', 'build', 'add', 'update', 'change', 'modify', 'edit', 'delete', 'remove', 'migrate', 'convert'];
  const codeScore = codeSignals.filter(s => lower.includes(s)).length;

  // Planning/reasoning signals
  const planSignals = ['plan', 'design', 'architect', 'analyze', 'think', 'reason', 'compare', 'evaluate', 'trade-off', 'strategy', 'approach', 'consider', 'assess', 'review'];
  const planScore = planSignals.filter(s => lower.includes(s)).length;

  // Complex reasoning signals
  const complexSignals = ['security', 'vulnerability', 'algorithm', 'optimize', 'proof', 'theorem', 'complexity', 'concurrent', 'parallel', 'distributed', 'architecture', 'performance', 'scale'];
  const complexScore = complexSignals.filter(s => lower.includes(s)).length;

  // Multi-step indicators
  const multiStepSignals = ['first', 'then', 'after', 'finally', 'step', 'and then', 'also', 'additionally', 'make sure'];
  const multiStepScore = multiStepSignals.filter(s => lower.includes(s)).length;

  // Has code blocks
  const hasCode = /```/.test(prompt) || /[{}();]/.test(prompt);
  const hasMultipleLines = prompt.includes('\n') && prompt.split('\n').length > 3;

  // Score-based classification
  let score = 0;
  score += codeScore * 2;
  score += planScore * 3;
  score += complexScore * 4;
  score += multiStepScore * 1.5;
  if (hasCode) score += 3;
  if (hasMultipleLines) score += 2;
  if (len > 500) score += 2;
  if (len > 1000) score += 3;
  if (wordCount > 50) score += 2;
  if (wordCount > 100) score += 3;

  if (score >= 20) return 'xhigh';
  if (score >= 12) return 'high';
  if (score >= 6) return 'medium';
  if (score >= 3) return 'low';
  return 'minimal';
}

/**
 * Map thinking level to reasoning budget
 */
export function thinkingBudget(level: ThinkingLevel): number {
  switch (level) {
    case 'off': return 0;
    case 'minimal': return 1024;
    case 'low': return 2048;
    case 'medium': return 4096;
    case 'high': return 8192;
    case 'xhigh': return 16384;
    default: return 4096;
  }
}
