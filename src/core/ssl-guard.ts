/**
 * SSL/TLS configuration helpers.
 *
 * Preventive SSL CA certificate checks and TLS verify resolution.
 */

import { existsSync, statSync } from 'fs';

const CA_BUNDLE_ENV_VARS = [
  'KAIRO_CA_BUNDLE',
  'SSL_CERT_FILE',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
];

const SKIP_VALUES = new Set(['1', 'true', 'yes', 'on']);

/**
 * Check if SSL guard is disabled via environment variable.
 */
function isSslGuardDisabled(): boolean {
  const val = process.env.KAIRO_SKIP_SSL_GUARD?.trim().toLowerCase() || '';
  return SKIP_VALUES.has(val);
}

/**
 * Validate a CA bundle path exists and is loadable.
 */
function validateBundlePath(label: string, value: string): void {
  if (!existsSync(value)) {
    throw new Error(`${label} points to a missing CA bundle: ${value}`);
  }
  try {
    const stat = statSync(value);
    if (!stat.isFile()) {
      throw new Error(`${label} does not point to a CA bundle file: ${value}`);
    }
    if (stat.size < 1024) {
      throw new Error(`${label} at ${value} appears corrupted (too small)`);
    }
  } catch (err: any) {
    if (err.message?.includes('points to a missing') || err.message?.includes('does not point')) throw err;
    // stat error — don't throw, just warn
  }
}

/**
 * Verify configured CA certificates are present and loadable.
 */
export function verifyCaBundle(): void {
  if (isSslGuardDisabled()) return;

  for (const envVar of CA_BUNDLE_ENV_VARS) {
    const value = process.env[envVar]?.trim();
    if (value) {
      validateBundlePath(envVar, value);
    }
  }
}

/**
 * Get TLS verification setting from environment.
 * Returns true/false for explicit settings, or undefined for defaults.
 */
export function getTlsVerify(): boolean | undefined {
  const val = process.env.KAIRO_TLS_VERIFY?.trim().toLowerCase();
  if (val === '0' || val === 'false' || val === 'no') return false;
  if (val === '1' || val === 'true' || val === 'yes') return true;
  return undefined;
}

/**
 * Get the CA bundle path from environment, if configured.
 */
export function getCaBundlePath(): string | null {
  for (const envVar of CA_BUNDLE_ENV_VARS) {
    const value = process.env[envVar]?.trim();
    if (value && existsSync(value)) return value;
  }
  return null;
}

/**
 * Check if SSL errors should be retried.
 */
export function isSslRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return msg.includes('ssl') || msg.includes('tls') || msg.includes('certificate') || msg.includes('cert');
}
