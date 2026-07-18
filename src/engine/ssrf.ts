/**
 * SSRF (Server-Side Request Forgery) protection.
 *
 * Validates resolved IP addresses are not in private/link-local ranges.
 */

import * as dns from 'dns';

export class SsrfError extends Error {
  constructor(host: string, ip: string) {
    super(`SSRF blocked: ${host} resolved to private IP ${ip}`);
    this.name = 'SsrfError';
  }
}

/**
 * Check if an IPv4 address is in a blocked range.
 * Allowed: loopback (127.x) for local dev.
 * Blocked: RFC 1918, link-local, CGNAT/cloud metadata, unspecified.
 */
export function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;

  const [a, b] = parts;

  // Loopback (127.0.0.0/8) — allowed
  if (a === 127) return false;

  // RFC 1918: 10.0.0.0/8
  if (a === 10) return true;

  // RFC 1918: 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;

  // RFC 1918: 192.168.0.0/16
  if (a === 192 && b === 168) return true;

  // RFC 3927: 169.254.0.0/16 (link-local, includes cloud metadata 169.254.169.254)
  if (a === 169 && b === 254) return true;

  // RFC 6598: 100.64.0.0/10 (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 0.0.0.0 — unspecified
  if (ip === '0.0.0.0') return true;

  return false;
}

/**
 * Check if an IP address is blocked.
 */
export function isBlockedIp(ip: string): boolean {
  // IPv4-mapped IPv6 ::ffff:x.x.x.x
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    return isBlockedIPv4(v4);
  }

  // IPv6 loopback
  if (ip === '::1') return false;

  // IPv6 unspecified
  if (ip === '::') return true;

  // Link-local fe80::/10
  if (ip.startsWith('fe80:') || ip.startsWith('FE80:')) return true;

  // ULA fc00::/7
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('FC') || ip.startsWith('FD')) return true;

  // For other IPv6, check if it's IPv4-mapped
  if (ip.includes(':')) {
    const segments = ip.split(':');
    if (segments.length === 8) {
      // Check if last 4 segments look like IPv4
      const last4 = segments.slice(4);
      if (last4.every(s => /^\d{1,3}$/.test(s))) {
        return isBlockedIPv4(last4.join('.'));
      }
    }
  }

  return false;
}

/**
 * Resolve a hostname and verify none of the resolved addresses are blocked.
 */
export async function checkSsrf(url: string): Promise<void> {
  const parsed = new URL(url);
  const host = parsed.hostname;

  // If host is already a literal IP, check directly
  if (/^[\d.:]+$/.test(host)) {
    if (isBlockedIp(host)) {
      throw new SsrfError(host, host);
    }
    return;
  }

  // Resolve via DNS
  return new Promise((resolve, reject) => {
    dns.resolve4(host, (err, addresses) => {
      if (err) {
        // DNS resolution failure — allow (will fail at fetch time)
        resolve();
        return;
      }

      for (const addr of addresses) {
        if (isBlockedIPv4(addr)) {
          reject(new SsrfError(host, addr));
          return;
        }
      }

      resolve();
    });
  });
}
