/**
 * Circuit breaker — prevents cascading failures in provider calls.
 */

export enum CircuitState {
  Closed = 'closed',
  Open = 'open',
  HalfOpen = 'half_open',
}

export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Duration in ms before transitioning to half-open */
  resetTimeoutMs: number;
  /** Number of successes in half-open before closing */
  successThreshold: number;
  /** Monitor window in ms */
  windowMs: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  successThreshold: 2,
  windowMs: 60_000,
};

export interface CircuitBreaker {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: Date;
  lastStateChange: Date;
  config: CircuitBreakerConfig;
}

/**
 * Create a new circuit breaker.
 */
export function createCircuitBreaker(
  config: CircuitBreakerConfig = DEFAULT_CIRCUIT_BREAKER_CONFIG,
): CircuitBreaker {
  return {
    state: CircuitState.Closed,
    failureCount: 0,
    successCount: 0,
    lastStateChange: new Date(),
    config,
  };
}

/**
 * Check if the circuit allows requests.
 */
export function canExecute(breaker: CircuitBreaker): boolean {
  switch (breaker.state) {
    case CircuitState.Closed:
      return true;
    case CircuitState.Open:
      if (!breaker.lastFailureTime) return true;
      return Date.now() - breaker.lastFailureTime.getTime() >= breaker.config.resetTimeoutMs;
    case CircuitState.HalfOpen:
      return true;
  }
}

/**
 * Record a success.
 */
export function recordBreakerSuccess(breaker: CircuitBreaker): CircuitBreaker {
  if (breaker.state === CircuitState.HalfOpen) {
    const newCount = breaker.successCount + 1;
    if (newCount >= breaker.config.successThreshold) {
      return {
        ...breaker,
        state: CircuitState.Closed,
        failureCount: 0,
        successCount: 0,
        lastStateChange: new Date(),
      };
    }
    return { ...breaker, successCount: newCount };
  }
  return { ...breaker, failureCount: 0, successCount: 0 };
}

/**
 * Record a failure.
 */
export function recordBreakerFailure(breaker: CircuitBreaker): CircuitBreaker {
  const newCount = breaker.failureCount + 1;

  if (breaker.state === CircuitState.HalfOpen) {
    return {
      ...breaker,
      state: CircuitState.Open,
      failureCount: newCount,
      successCount: 0,
      lastFailureTime: new Date(),
      lastStateChange: new Date(),
    };
  }

  if (newCount >= breaker.config.failureThreshold) {
    return {
      ...breaker,
      state: CircuitState.Open,
      failureCount: newCount,
      lastFailureTime: new Date(),
      lastStateChange: new Date(),
    };
  }

  return { ...breaker, failureCount: newCount };
}

/**
 * Reset the circuit breaker to closed state.
 */
export function resetCircuitBreaker(breaker: CircuitBreaker): CircuitBreaker {
  return {
    ...breaker,
    state: CircuitState.Closed,
    failureCount: 0,
    successCount: 0,
    lastStateChange: new Date(),
  };
}
