/**
 * Domain allowlist matching with precomputed host → path-prefix lookup.
 *
 * Entries parsed once into a HashMap for O(1) host lookup
 * followed by a small linear scan over path prefixes.
 */

/**
 * Canonical form for domain comparison: trim, strip trailing slashes/dots,
 * remove www. prefix, lowercase.
 */
export function normalizeDomain(raw: string): string {
  let s = raw.trim().replace(/\/+$/, '').replace(/\.+$/, '');
  if (s.startsWith('www.')) s = s.slice(4);
  return s.toLowerCase();
}

type HostEntry =
  | { kind: 'any_path' }
  | { kind: 'path_prefixes'; prefixes: string[] };

/**
 * Precomputed domain allowlist. O(1) host lookup + linear path prefix scan.
 */
export class DomainMatcher {
  private entries: Map<string, HostEntry> = new Map();

  constructor(rawEntries: string[]) {
    for (const raw of rawEntries) {
      const normalized = normalizeDomain(raw);
      if (!normalized) continue;

      const slashIdx = normalized.indexOf('/');
      const host = slashIdx === -1 ? normalized : normalized.slice(0, slashIdx);
      const rawPath = slashIdx === -1 ? undefined : normalized.slice(slashIdx);

      if (!rawPath) {
        // Host-only → any path allowed
        this.entries.set(host, { kind: 'any_path' });
      } else {
        // Don't downgrade AnyPath
        const existing = this.entries.get(host);
        if (existing?.kind === 'any_path') continue;

        // Normalize path: ensure leading '/', strip trailing '/'
        const prefix = rawPath.replace(/\/+$/, '');
        const normalizedPrefix = prefix.startsWith('/') ? prefix : `/${prefix}`;

        const existingPrefixes =
          existing?.kind === 'path_prefixes' ? existing.prefixes : [];
        this.entries.set(host, {
          kind: 'path_prefixes',
          prefixes: [...existingPrefixes, normalizedPrefix],
        });
      }
    }
  }

  /**
   * Check if a URL is allowed by the domain allowlist.
   */
  isAllowed(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = normalizeDomain(parsed.hostname);
      const path = parsed.pathname;

      const entry = this.entries.get(host);
      if (!entry) return false;

      if (entry.kind === 'any_path') return true;

      return entry.prefixes.some(prefix => path.startsWith(prefix));
    } catch {
      return false;
    }
  }

  /**
   * Get the domain from a URL.
   */
  static domainFromUrl(url: string): string {
    try {
      return normalizeDomain(new URL(url).hostname);
    } catch {
      return '';
    }
  }
}
