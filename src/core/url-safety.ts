/**
 * URL safety — check URLs for SSRF and other security risks.
 */

const PRIVATE_IP_RANGES = [
  /^127\./,           // Loopback
  /^10\./,            // Private class A
  /^172\.(1[6-9]|2\d|3[01])\./,  // Private class B
  /^192\.168\./,      // Private class C
  /^169\.254\./,      // Link-local
  /^0\./,             // Current network
  /^::1$/,            // IPv6 loopback
  /^fc00:/,           // IPv6 private
  /^fe80:/,           // IPv6 link-local
  /^fd/,              // IPv6 private
];

const BLOCKED_HOSTS = new Set([
  'metadata.google.internal',
  '169.254.169.254',    // AWS/GCP/Azure metadata
  'metadata.google.internal.',
]);

/**
 * Check if a URL is safe to fetch (not SSRF).
 */
export function isUrlSafe(url: string): { safe: boolean; reason?: string } {
  try {
    const parsed = new URL(url);

    // Block non-http(s) protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { safe: false, reason: `Blocked protocol: ${parsed.protocol}` };
    }

    // Block known metadata endpoints
    if (BLOCKED_HOSTS.has(parsed.hostname)) {
      return { safe: false, reason: `Blocked host: ${parsed.hostname}` };
    }

    // Block private IP ranges
    for (const range of PRIVATE_IP_RANGES) {
      if (range.test(parsed.hostname)) {
        return { safe: false, reason: `Blocked private IP: ${parsed.hostname}` };
      }
    }

    // Block localhost
    if (['localhost', '0.0.0.0'].includes(parsed.hostname)) {
      return { safe: false, reason: `Blocked localhost: ${parsed.hostname}` };
    }

    return { safe: true };
  } catch (err: any) {
    return { safe: false, reason: `Invalid URL: ${err.message}` };
  }
}

/**
 * Validate and sanitize a URL for safe fetching.
 */
export function sanitizeUrl(url: string): { url: string; error?: string } {
  const check = isUrlSafe(url);
  if (!check.safe) return { url, error: check.reason };

  try {
    const parsed = new URL(url);
    // Force HTTPS for non-localhost
    if (parsed.protocol === 'http:' && parsed.hostname !== 'localhost') {
      parsed.protocol = 'https:';
    }
    return { url: parsed.toString() };
  } catch {
    return { url, error: 'Invalid URL format' };
  }
}
