/**
 * API error classification for smart failover and recovery.
 *
 * Provides a structured taxonomy of API errors and determines
 * the correct recovery action (retry, rotate, fallback, compress, abort).
 */

export type FailoverReason =
  | 'auth'                    // Transient auth (401/403) — refresh/rotate
  | 'auth_permanent'          // Auth failed after refresh — abort
  | 'billing'                 // 402 or credit exhaustion — rotate immediately
  | 'rate_limit'              // 429 — backoff then rotate
  | 'upstream_rate_limit'     // Aggregator 429 — fallback to different model
  | 'overloaded'              // 503/529 — provider overloaded, backoff
  | 'server_error'            // 500/502 — internal server error, retry
  | 'timeout'                 // Connection/read timeout — rebuild client + retry
  | 'ssl_cert_verification'   // TLS cert failure — abort with guidance
  | 'context_overflow'        // Context too large — compress, not failover
  | 'payload_too_large'       // 413 — compress payload
  | 'model_not_found'         // 404 or invalid model — fallback
  | 'content_policy_blocked'  // Safety filter — don't retry unchanged
  | 'format_error'            // 400 bad request — abort or strip + retry
  | 'unknown';                // Unclassifiable — retry with backoff

export interface ClassifiedError {
  reason: FailoverReason;
  statusCode: number | null;
  message: string;
  retryable: boolean;
  shouldRotate: boolean;
  shouldFallback: boolean;
  shouldCompress: boolean;
  cooldownSeconds: number;
}

/**
 * Classify an API error into a structured category.
 */
export function classifyError(error: unknown): ClassifiedError {
  const statusCode = getStatusCode(error);
  const message = getErrorMessage(error);
  const lower = message.toLowerCase();

  // Rate limit (429)
  if (statusCode === 429 || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      reason: 'rate_limit',
      statusCode,
      message,
      retryable: true,
      shouldRotate: true,
      shouldFallback: false,
      shouldCompress: false,
      cooldownSeconds: 60,
    };
  }

  // Billing/quota (402)
  if (statusCode === 402 || lower.includes('quota') || lower.includes('billing') || lower.includes('insufficient')) {
    return {
      reason: 'billing',
      statusCode,
      message,
      retryable: false,
      shouldRotate: true,
      shouldFallback: true,
      shouldCompress: false,
      cooldownSeconds: 0,
    };
  }

  // Auth (401/403)
  if (statusCode === 401 || statusCode === 403 || lower.includes('unauthorized') || lower.includes('forbidden')) {
    return {
      reason: 'auth',
      statusCode,
      message,
      retryable: false,
      shouldRotate: true,
      shouldFallback: false,
      shouldCompress: false,
      cooldownSeconds: 0,
    };
  }

  // Model not found (404)
  if (statusCode === 404 || lower.includes('model not found') || lower.includes('not found')) {
    return {
      reason: 'model_not_found',
      statusCode,
      message,
      retryable: false,
      shouldRotate: false,
      shouldFallback: true,
      shouldCompress: false,
      cooldownSeconds: 0,
    };
  }

  // Context overflow
  if (lower.includes('context') && (lower.includes('too long') || lower.includes('overflow') || lower.includes('exceed'))) {
    return {
      reason: 'context_overflow',
      statusCode,
      message,
      retryable: true,
      shouldRotate: false,
      shouldFallback: false,
      shouldCompress: true,
      cooldownSeconds: 0,
    };
  }

  // Payload too large (413)
  if (statusCode === 413 || lower.includes('payload too large') || lower.includes('request too large')) {
    return {
      reason: 'payload_too_large',
      statusCode,
      message,
      retryable: true,
      shouldRotate: false,
      shouldFallback: false,
      shouldCompress: true,
      cooldownSeconds: 0,
    };
  }

  // Server error (5xx)
  if (statusCode && statusCode >= 500) {
    return {
      reason: 'server_error',
      statusCode,
      message,
      retryable: true,
      shouldRotate: false,
      shouldFallback: true,
      shouldCompress: false,
      cooldownSeconds: 5,
    };
  }

  // Overloaded (503/529)
  if (statusCode === 503 || statusCode === 529) {
    return {
      reason: 'overloaded',
      statusCode,
      message,
      retryable: true,
      shouldRotate: false,
      shouldFallback: false,
      shouldCompress: false,
      cooldownSeconds: 30,
    };
  }

  // Timeout
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('econnreset')) {
    return {
      reason: 'timeout',
      statusCode,
      message,
      retryable: true,
      shouldRotate: false,
      shouldFallback: false,
      shouldCompress: false,
      cooldownSeconds: 5,
    };
  }

  // SSL/TLS
  if (lower.includes('ssl') || lower.includes('tls') || lower.includes('certificate')) {
    return {
      reason: 'ssl_cert_verification',
      statusCode,
      message,
      retryable: false,
      shouldRotate: false,
      shouldFallback: false,
      shouldCompress: false,
      cooldownSeconds: 0,
    };
  }

  // Content policy
  if (lower.includes('content policy') || lower.includes('safety') || lower.includes('blocked')) {
    return {
      reason: 'content_policy_blocked',
      statusCode,
      message,
      retryable: false,
      shouldRotate: false,
      shouldFallback: false,
      shouldCompress: false,
      cooldownSeconds: 0,
    };
  }

  // Default: unknown
  return {
    reason: 'unknown',
    statusCode,
    message,
    retryable: true,
    shouldRotate: false,
    shouldFallback: false,
    shouldCompress: false,
    cooldownSeconds: 5,
  };
}

/**
 * Get status code from an error object.
 */
function getStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const e = error as Record<string, unknown>;
  return (typeof e.status === 'number' ? e.status : null)
    ?? (typeof e.statusCode === 'number' ? e.statusCode : null)
    ?? null;
}

/**
 * Get error message from an error object.
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    return String(e.message || e.error || JSON.stringify(e));
  }
  return String(error);
}

/**
 * Check if an error is retryable.
 */
export function isRetryable(error: unknown): boolean {
  return classifyError(error).retryable;
}

/**
 * Check if an error requires credential rotation.
 */
export function shouldRotateCredentials(error: unknown): boolean {
  return classifyError(error).shouldRotate;
}

/**
 * Check if an error requires provider fallback.
 */
export function shouldFallbackProvider(error: unknown): boolean {
  return classifyError(error).shouldFallback;
}

/**
 * Check if an error requires context compression.
 */
export function shouldCompressContext(error: unknown): boolean {
  return classifyError(error).shouldCompress;
}
