/**
 * Credential persistence — disk-boundary sanitization.
 *
 * Strips raw secret values before writing credential entries to disk.
 */

// Secret value keys that must never be persisted in plaintext
const SECRET_VALUE_KEYS = new Set([
  'access_token', 'refresh_token', 'api_key', 'apikey', 'api_token',
  'auth_token', 'authorization', 'bearer_token', 'client_secret',
  'credential', 'credentials', 'id_token', 'oauth_token', 'private_key',
  'secret_key', 'session_token', 'password', 'secret', 'token', 'tokens',
]);

// Safe metadata keys that CAN be persisted
const SAFE_METADATA_KEYS = new Set([
  'secret_fingerprint', 'secret_source', 'token_type', 'scope', 'client_id',
  'expires_at', 'expires_at_ms', 'expires_in', 'last_refresh',
  'last_status', 'last_status_at', 'last_error_code', 'last_error_reason',
]);

/**
 * Check if a key name looks like it contains a secret value.
 */
function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase().replace(/-/g, '_');
  if (SECRET_VALUE_KEYS.has(lower)) return true;
  const suffixes = ['_api_key', '_token', '_secret', '_password', '_key'];
  return suffixes.some(s => lower.endsWith(s));
}

/**
 * Sanitize a credential entry for disk persistence.
 * Removes raw secret values, keeping only fingerprints and metadata.
 */
export function sanitizeForPersistence(entry: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(entry)) {
    if (isSecretKey(key)) {
      // Replace with fingerprint if not already present
      const fpKey = `${key}_fingerprint`;
      if (!(fpKey in entry) && typeof value === 'string' && value.length > 0) {
        result[fpKey] = fingerprintSecret(value);
      }
      continue; // skip the raw value
    }
    result[key] = value;
  }

  return result;
}

/**
 * Create a fingerprint of a secret (first 8 chars of SHA-256).
 */
export function fingerprintSecret(secret: string): string {
  try {
    const { createHash } = require('crypto');
    return createHash('sha256').update(secret).digest('hex').slice(0, 8);
  } catch {
    return '***';
  }
}

/**
 * Check if an entry has external credentials.
 */
export function isBorrowedCredential(entry: Record<string, unknown>): boolean {
  const source = String(entry.secret_source || entry.source || '');
  return source.length > 0 && !source.startsWith('external') && !source.startsWith('kairo');
}

/**
 * Mask a credential for display (show first 6 and last 4 chars).
 */
export function maskCredential(value: string): string {
  if (value.length < 18) return '***';
  return value.slice(0, 6) + '***' + value.slice(-4);
}
