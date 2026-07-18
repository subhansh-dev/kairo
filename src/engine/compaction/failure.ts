/**
 * Compaction failure tracking — monitors failures and triggers circuit breaker.
 */

export interface CompactionFailure {
  timestamp: Date;
  error: string;
  phase: 'prompt' | 'summary' | 'assemble' | 'intra' | 'inter';
  retryCount: number;
}

export interface CompactionFailureTracker {
  failures: CompactionFailure[];
  lastFailure?: Date;
  consecutiveFailures: number;
  circuitOpen: boolean;
  circuitOpenedAt?: Date;
}

const MAX_CONSECUTIVE_FAILURES = 3;
const CIRCUIT_OPEN_DURATION_MS = 60_000; // 1 minute

/**
 * Create a fresh failure tracker.
 */
export function createFailureTracker(): CompactionFailureTracker {
  return {
    failures: [],
    consecutiveFailures: 0,
    circuitOpen: false,
  };
}

/**
 * Record a compaction failure.
 */
export function recordFailure(
  tracker: CompactionFailureTracker,
  error: string,
  phase: CompactionFailure['phase'],
): CompactionFailureTracker {
  const failure: CompactionFailure = {
    timestamp: new Date(),
    error,
    phase,
    retryCount: tracker.consecutiveFailures,
  };

  const newConsecutive = tracker.consecutiveFailures + 1;
  const circuitOpen = newConsecutive >= MAX_CONSECUTIVE_FAILURES;

  return {
    failures: [...tracker.failures, failure],
    lastFailure: new Date(),
    consecutiveFailures: newConsecutive,
    circuitOpen,
    circuitOpenedAt: circuitOpen ? new Date() : tracker.circuitOpenedAt,
  };
}

/**
 * Record a compaction success — resets consecutive failures.
 */
export function recordSuccess(
  tracker: CompactionFailureTracker,
): CompactionFailureTracker {
  return {
    ...tracker,
    consecutiveFailures: 0,
    circuitOpen: false,
    circuitOpenedAt: undefined,
  };
}

/**
 * Check if the circuit breaker is allowing operations.
 */
export function isCircuitClosed(tracker: CompactionFailureTracker): boolean {
  if (!tracker.circuitOpen) return true;
  if (!tracker.circuitOpenedAt) return true;

  const elapsed = Date.now() - tracker.circuitOpenedAt.getTime();
  if (elapsed > CIRCUIT_OPEN_DURATION_MS) {
    return true; // Half-open: allow one attempt
  }

  return false;
}

/**
 * Get recent failures (last N).
 */
export function getRecentFailures(
  tracker: CompactionFailureTracker,
  count: number = 10,
): CompactionFailure[] {
  return tracker.failures.slice(-count);
}
