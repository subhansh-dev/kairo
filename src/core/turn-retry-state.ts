/**
 * Per-attempt recovery bookkeeping for the conversation turn loop.
 *
 * Each guard fires its recovery branch at most once per attempt.
 * The restart signals are read by the loop after the attempt to decide
 * whether to rebuild the request and retry.
 */

export interface TurnRetryState {
  // Per-provider credential refresh guards
  apiKeyRefreshAttempted: boolean;
  oauthRefreshAttempted: boolean;

  // Format / payload recovery guards
  thinkingSigRetryAttempted: boolean;
  imageShrinkRetryAttempted: boolean;
  multimodalToolContentRetryAttempted: boolean;
  invalidContentRetryAttempted: boolean;

  // Transport / rate-limit recovery
  primaryRecoveryAttempted: boolean;
  hasRetried429: boolean;

  // Auth-failure provider failover
  authFailoverAttempted: boolean;

  // Restart signals (read by the outer loop after the attempt)
  restartWithCompressedMessages: boolean;
  restartWithLengthContinuation: boolean;
  restartWithRebuiltMessages: boolean;
}

/**
 * Create a fresh TurnRetryState for a new API-call attempt.
 */
export function createTurnRetryState(): TurnRetryState {
  return {
    apiKeyRefreshAttempted: false,
    oauthRefreshAttempted: false,
    thinkingSigRetryAttempted: false,
    imageShrinkRetryAttempted: false,
    multimodalToolContentRetryAttempted: false,
    invalidContentRetryAttempted: false,
    primaryRecoveryAttempted: false,
    hasRetried429: false,
    authFailoverAttempted: false,
    restartWithCompressedMessages: false,
    restartWithLengthContinuation: false,
    restartWithRebuiltMessages: false,
  };
}

/**
 * Reset all restart signals (called at the top of each retry iteration).
 */
export function resetRestartSignals(state: TurnRetryState): void {
  state.restartWithCompressedMessages = false;
  state.restartWithLengthContinuation = false;
  state.restartWithRebuiltMessages = false;
}

/**
 * Check if any restart signal is set.
 */
export function hasRestartSignal(state: TurnRetryState): boolean {
  return (
    state.restartWithCompressedMessages ||
    state.restartWithLengthContinuation ||
    state.restartWithRebuiltMessages
  );
}
