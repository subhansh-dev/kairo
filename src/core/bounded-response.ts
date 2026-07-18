/**
 * Bounded reads of HTTP error response bodies.
 *
 * When a provider returns a non-OK status on a streaming request, we read
 * the response body for diagnostics — but with bounds to prevent memory
 * bloat or indefinite hangs.
 */

const DEFAULT_ERROR_BODY_MAX_BYTES = 64 * 1024; // 64KB
const DEFAULT_ERROR_BODY_TIMEOUT_MS = 10_000; // 10 seconds

/**
 * Read a non-OK response body with a byte cap and a hard deadline.
 * Returns the decoded body text, truncated to maxBytes.
 * Never raises: any error is swallowed and best-effort partial text is returned.
 */
export async function readBoundedErrorBody(
  response: Response,
  maxBytes = DEFAULT_ERROR_BODY_MAX_BYTES,
  timeoutMs = DEFAULT_ERROR_BODY_TIMEOUT_MS,
): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const text = await response.text();
      clearTimeout(timeout);
      return text.slice(0, maxBytes);
    } catch {
      clearTimeout(timeout);
      return '';
    }
  } catch {
    return '';
  }
}

/**
 * Format an HTTP error response into a diagnostic string.
 */
export function formatHttpError(
  status: number,
  statusText: string,
  body: string,
  provider?: string,
): string {
  const preview = body.slice(0, 300).replace(/\n/g, ' ').trim();
  const parts = [
    `${provider ? `[${provider}] ` : ''}HTTP ${status}`,
    statusText,
    preview ? `— ${preview}` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

/**
 * Check if an HTTP status is retryable (5xx or 429).
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/**
 * Get a human-readable description of an HTTP status code.
 */
export function httpStatusDescription(status: number): string {
  const descriptions: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized — check your API key',
    403: 'Forbidden — insufficient permissions',
    404: 'Not Found',
    408: 'Request Timeout',
    429: 'Rate Limited — too many requests',
    500: 'Internal Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
    504: 'Gateway Timeout',
  };
  return descriptions[status] || `HTTP ${status}`;
}
