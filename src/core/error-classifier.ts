/**
 * Kairo — Error Classifier
 * Structured error taxonomy with recovery strategies.
 * Ported from Hermes Agent's error_classifier.py
 *
 * Instead of scattered string-matching, every API error goes through
 * this classifier which returns a recovery action.
 */

// ─── Error Taxonomy ─────────────────────────────────────────────

export type FailoverReason =
  // Auth
  | 'auth'                    // 401/403 — rotate credential
  | 'auth_permanent'          // Auth failed after refresh — abort
  // Billing
  | 'billing'                 // 402 — rotate immediately
  | 'rate_limit'              // 429 — backoff then rotate
  | 'upstream_rate_limit'     // Aggregator 429 — fallback model
  // Server
  | 'overloaded'              // 503/529 — backoff
  | 'server_error'            // 500/502 — retry
  // Transport
  | 'timeout'                 // Connection/read timeout
  | 'ssl_error'               // TLS failure — don't retry
  // Context
  | 'context_overflow'        // Too large — compress
  | 'payload_too_large'       // 413 — compress
  // Model
  | 'model_not_found'         // 404 — fallback model
  | 'content_policy_blocked'  // Safety filter — don't retry
  // Format
  | 'format_error'            // 400 — fix and retry
  // Catch-all
  | 'unknown';

// ─── Classification Result ──────────────────────────────────────

export interface ClassifiedError {
  reason: FailoverReason;
  statusCode?: number;
  provider?: string;
  model?: string;
  message: string;
  retryable: boolean;
  shouldCompress: boolean;
  shouldRotateCredential: boolean;
  shouldFallback: boolean;
  backoffMs?: number;
}

// ─── Classifier ─────────────────────────────────────────────────

export function classifyApiError(
  error: any,
  provider?: string,
  model?: string,
): ClassifiedError {
  const statusCode = extractStatusCode(error);
  const message = extractMessage(error);

  // Auth errors
  if (statusCode === 401 || statusCode === 403) {
    // Always try rotating credential first — only abort if explicitly permanent
    if (message.toLowerCase().includes('revoked') || message.toLowerCase().includes('disabled') || message.toLowerCase().includes('invalid_api_key')) {
      return make('auth_permanent', statusCode, provider, model, message, {
        retryable: false,
      });
    }
    return make('auth', statusCode, provider, model, message, {
      retryable: true,
      shouldRotateCredential: true,
    });
  }

  // Billing
  if (statusCode === 402) {
    return make('billing', statusCode, provider, model, message, {
      retryable: true,
      shouldRotateCredential: true,
    });
  }

  // Rate limit
  if (statusCode === 429) {
    const retryAfter = extractRetryAfter(error);
    if (isUpstreamRateLimit(message)) {
      return make('upstream_rate_limit', statusCode, provider, model, message, {
        retryable: true,
        shouldFallback: true,
        backoffMs: retryAfter || 5000,
      });
    }
    return make('rate_limit', statusCode, provider, model, message, {
      retryable: true,
      shouldRotateCredential: true,
      backoffMs: retryAfter || 60000,
    });
  }

  // Server errors
  if (statusCode === 500 || statusCode === 502) {
    return make('server_error', statusCode, provider, model, message, {
      retryable: true,
      backoffMs: 2000,
    });
  }

  if (statusCode === 503 || statusCode === 529) {
    return make('overloaded', statusCode, provider, model, message, {
      retryable: true,
      backoffMs: 10000,
    });
  }

  // Context overflow
  if (statusCode === 413 || isContextOverflow(message)) {
    return make('context_overflow', statusCode, provider, model, message, {
      retryable: true,
      shouldCompress: true,
    });
  }

  // Model not found
  if (statusCode === 404) {
    return make('model_not_found', statusCode, provider, model, message, {
      retryable: true,
      shouldFallback: true,
    });
  }

  // Bad request
  if (statusCode === 400) {
    return make('format_error', statusCode, provider, model, message, {
      retryable: false,
    });
  }

  // Timeout
  if (isTimeout(message)) {
    return make('timeout', undefined, provider, model, message, {
      retryable: true,
      backoffMs: 3000,
    });
  }

  // SSL
  if (isSslError(message)) {
    return make('ssl_error', undefined, provider, model, message, {
      retryable: false,
    });
  }

  // Content policy
  if (isContentPolicy(message)) {
    return make('content_policy_blocked', statusCode, provider, model, message, {
      retryable: false,
    });
  }

  // Unknown
  return make('unknown', statusCode, provider, model, message, {
    retryable: true,
    backoffMs: 5000,
  });
}

// ─── Helpers ────────────────────────────────────────────────────

function make(
  reason: FailoverReason,
  statusCode: number | undefined,
  provider: string | undefined,
  model: string | undefined,
  message: string,
  opts: Partial<ClassifiedError>,
): ClassifiedError {
  return {
    reason,
    statusCode,
    provider,
    model,
    message,
    retryable: opts.retryable ?? true,
    shouldCompress: opts.shouldCompress ?? false,
    shouldRotateCredential: opts.shouldRotateCredential ?? false,
    shouldFallback: opts.shouldFallback ?? false,
    backoffMs: opts.backoffMs,
  };
}

function extractStatusCode(error: any): number | undefined {
  if (typeof error?.status === 'number') return error.status;
  if (typeof error?.statusCode === 'number') return error.statusCode;
  const match = String(error?.message || '').match(/\b(\d{3})\b/);
  return match ? parseInt(match[1]) : undefined;
}

function extractMessage(error: any): string {
  if (typeof error?.message === 'string') return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function extractRetryAfter(error: any): number | undefined {
  const header = error?.headers?.['retry-after'] || error?.retryAfter;
  if (typeof header === 'number') return header * 1000;
  if (typeof header === 'string') {
    const num = parseInt(header);
    return isNaN(num) ? undefined : num * 1000;
  }
  return undefined;
}

function isUpstreamRateLimit(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('upstream') && lower.includes('rate') ||
    lower.includes('model_rate_limit') ||
    lower.includes('provider rate limit');
}

function isContextOverflow(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('context') && (lower.includes('too long') || lower.includes('overflow') || lower.includes('exceed'));
}

function isTimeout(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('timeout') || lower.includes('timed out') || lower.includes('ETIMEDOUT');
}

function isSslError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('ssl') || lower.includes('certificate') || lower.includes('tls') || lower.includes('UNABLE_TO_VERIFY');
}

function isContentPolicy(msg: string): boolean {
  const lower = msg.toLowerCase();
  return lower.includes('content policy') || lower.includes('safety') || lower.includes('blocked') || lower.includes('harmful');
}

// ─── Recovery Strategy ──────────────────────────────────────────

export function getRecoveryAction(error: ClassifiedError): {
  action: 'retry' | 'rotate' | 'fallback' | 'compress' | 'abort';
  backoffMs: number;
  message: string;
} {
  if (!error.retryable) {
    return { action: 'abort', backoffMs: 0, message: `Not retryable: ${error.reason}` };
  }

  if (error.shouldCompress) {
    return { action: 'compress', backoffMs: 0, message: 'Context too large — compressing' };
  }

  if (error.shouldRotateCredential) {
    return { action: 'rotate', backoffMs: error.backoffMs || 5000, message: `Rotating credential: ${error.reason}` };
  }

  if (error.shouldFallback) {
    return { action: 'fallback', backoffMs: error.backoffMs || 2000, message: `Falling back to different model: ${error.reason}` };
  }

  return { action: 'retry', backoffMs: error.backoffMs || 3000, message: `Retrying: ${error.reason}` };
}
