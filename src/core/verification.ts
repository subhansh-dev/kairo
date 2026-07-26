/**
 * Verification module — evidence-based coding verification.
 *
 * Tracks verification evidence and provides guidance for code quality.
 */

export interface VerificationEvidence {
  type: string;     // 'test' | 'lint' | 'build' | 'typecheck' | 'review'
  status: string;   // 'pass' | 'fail' | 'skip'
  command: string;
  timestamp: number;
  durationMs: number;
  output?: string;
}

export interface VerificationState {
  evidence: VerificationEvidence[];
  lastVerifiedAt: number | null;
  consecutiveFailures: number;
}

// Per-session verification state
const sessionState = new Map<string, VerificationState>();

/**
 * Get or create verification state for a session.
 */
function getState(sessionId: string): VerificationState {
  if (!sessionState.has(sessionId)) {
    sessionState.set(sessionId, {
      evidence: [],
      lastVerifiedAt: null,
      consecutiveFailures: 0,
    });
  }
  return sessionState.get(sessionId)!;
}

/**
 * Record verification evidence.
 */
export function recordVerificationEvidence(
  sessionId: string,
  evidence: Omit<VerificationEvidence, 'timestamp'>,
): void {
  const state = getState(sessionId);
  const full: VerificationEvidence = {
    ...evidence,
    timestamp: Date.now(),
  };
  state.evidence.push(full);

  if (evidence.status === 'pass') {
    state.lastVerifiedAt = full.timestamp;
    state.consecutiveFailures = 0;
  } else if (evidence.status === 'fail') {
    state.consecutiveFailures++;
  }
}

/**
 * Check if the session has recent verification evidence.
 */
export function hasRecentVerification(sessionId: string, maxAgeMs = 300_000): boolean {
  const state = getState(sessionId);
  if (!state.lastVerifiedAt) return false;
  return Date.now() - state.lastVerifiedAt < maxAgeMs;
}

/**
 * Get the verification pass rate for a session.
 */
export function getVerificationPassRate(sessionId: string): number {
  const state = getState(sessionId);
  if (state.evidence.length === 0) return 1;
  const passed = state.evidence.filter(e => e.status === 'pass').length;
  return passed / state.evidence.length;
}

/**
 * Get recent verification evidence.
 */
export function getRecentEvidence(sessionId: string, limit = 5): VerificationEvidence[] {
  const state = getState(sessionId);
  return state.evidence.slice(-limit);
}

/**
 * Check if verification is needed (no recent evidence or failures).
 */
export function isVerificationNeeded(sessionId: string): boolean {
  const state = getState(sessionId);
  if (state.evidence.length === 0) return true;
  if (state.consecutiveFailures > 0) return true;
  if (!hasRecentVerification(sessionId)) return true;
  return false;
}

/**
 * Get verification guidance for the agent.
 */
export function getVerificationGuidance(sessionId: string): string | null {
  if (!isVerificationNeeded(sessionId)) return null;

  const state = getState(sessionId);
  if (state.consecutiveFailures > 2) {
    return 'Multiple verification failures detected. Consider reviewing the changes before retrying.';
  }
  if (state.evidence.length === 0) {
    return 'No verification evidence recorded. Consider running tests or type-checking.';
  }
  return null;
}

/**
 * Clear verification state for a session.
 */
export function clearVerificationState(sessionId: string): void {
  sessionState.delete(sessionId);
}
