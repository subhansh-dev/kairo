/**
 * Custom error classes for Kairo.
 */

/**
 * Raised when SSL/TLS certificate bundle configuration fails.
 */
export class SSLConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SSLConfigurationError';
  }
}

/**
 * Raised when a provider closes a stream without yielding a response.
 */
export class EmptyStreamError extends Error {
  constructor(message = 'Provider closed stream without response') {
    super(message);
    this.name = 'EmptyStreamError';
  }
}

/**
 * Raised when a tool call is invalid or malformed.
 */
export class InvalidToolCallError extends Error {
  toolName: string;
  constructor(toolName: string, message: string) {
    super(message);
    this.name = 'InvalidToolCallError';
    this.toolName = toolName;
  }
}

/**
 * Raised when context exceeds the model's limit.
 */
export class ContextOverflowError extends Error {
  tokenCount: number;
  maxTokens: number;
  constructor(tokenCount: number, maxTokens: number) {
    super(`Context overflow: ${tokenCount} tokens exceeds limit of ${maxTokens}`);
    this.name = 'ContextOverflowError';
    this.tokenCount = tokenCount;
    this.maxTokens = maxTokens;
  }
}

/**
 * Raised when all providers are exhausted.
 */
export class AllProvidersExhaustedError extends Error {
  attemptedProviders: string[];
  constructor(attemptedProviders: string[], message = 'All providers exhausted') {
    super(message);
    this.name = 'AllProvidersExhaustedError';
    this.attemptedProviders = attemptedProviders;
  }
}

/**
 * Raised when iteration budget is exhausted.
 */
export class IterationBudgetExhaustedError extends Error {
  used: number;
  max: number;
  constructor(used: number, max: number) {
    super(`Iteration budget exhausted: ${used}/${max}`);
    this.name = 'IterationBudgetExhaustedError';
    this.used = used;
    this.max = max;
  }
}

/**
 * Raised when a safety check blocks an operation.
 */
export class SafetyBlockedError extends Error {
  reason: string;
  toolName: string;
  constructor(toolName: string, reason: string) {
    super(`Safety blocked ${toolName}: ${reason}`);
    this.name = 'SafetyBlockedError';
    this.reason = reason;
    this.toolName = toolName;
  }
}

/**
 * Raised when a rate limit is hit.
 */
export class RateLimitError extends Error {
  retryAfterSeconds: number;
  provider: string;
  constructor(provider: string, retryAfterSeconds: number) {
    super(`Rate limited by ${provider}, retry after ${retryAfterSeconds}s`);
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
    this.provider = provider;
  }
}
