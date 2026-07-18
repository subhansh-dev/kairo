/**
 * URLLIB security — secure HTTP request utilities.
 */

/**
 * Check if a URL is safe to request (not SSRF).
 */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Only allow http(s)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;

    // Block localhost and private IPs
    const hostname = parsed.hostname;
    if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname)) return false;
    if (hostname.startsWith('192.168.') || hostname.startsWith('10.') || hostname.startsWith('172.')) return false;
    if (hostname.startsWith('169.254.')) return false;

    // Block metadata endpoints
    if (['metadata.google.internal', '169.254.169.254'].includes(hostname)) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitize URL for safe logging (redact query params with secrets).
 */
export function sanitizeUrlForLogging(url: string): string {
  try {
    const parsed = new URL(url);
    // Redact common secret query params
    const secretParams = ['key', 'token', 'secret', 'password', 'api_key', 'apikey'];
    for (const param of secretParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.set(param, '***');
      }
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Get default request headers.
 */
export function getDefaultHeaders(): Record<string, string> {
  return {
    'User-Agent': 'Kairo/1.0',
    'Accept': 'application/json',
  };
}

/**
 * Build a safe fetch request.
 */
export function buildSafeRequest(url: string, opts: RequestInit = {}): { url: string; opts: RequestInit; error?: string } {
  if (!isSafeUrl(url)) {
    return { url, opts, error: 'URL failed safety check (possible SSRF)' };
  }

  return {
    url,
    opts: {
      ...opts,
      headers: {
        ...getDefaultHeaders(),
        ...opts.headers,
      },
    },
  };
}
