/**
 * Pairing — device pairing for remote access.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';

const PAIRING_DIR = join(homedir(), '.kairo', 'pairing');

export interface PairingCode {
  code: string;
  deviceId?: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

/**
 * Generate a new pairing code.
 */
export function generatePairingCode(deviceId?: string, ttlMs = 300_000): PairingCode {
  const code = randomBytes(4).toString('hex').toUpperCase();
  const pairing: PairingCode = {
    code,
    deviceId,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    used: false,
  };

  try {
    if (!existsSync(PAIRING_DIR)) mkdirSync(PAIRING_DIR, { recursive: true });
    writeFileSync(join(PAIRING_DIR, `${code}.json`), JSON.stringify(pairing, null, 2), 'utf-8');
  } catch { /* best-effort */ }

  return pairing;
}

/**
 * Validate a pairing code.
 */
export function validatePairingCode(code: string): { valid: boolean; pairing?: PairingCode; error?: string } {
  try {
    const path = join(PAIRING_DIR, `${code}.json`);
    if (!existsSync(path)) return { valid: false, error: 'Code not found' };

    const pairing: PairingCode = JSON.parse(readFileSync(path, 'utf-8'));

    if (pairing.used) return { valid: false, error: 'Code already used' };
    if (Date.now() > pairing.expiresAt) return { valid: false, error: 'Code expired' };

    // Mark as used
    pairing.used = true;
    writeFileSync(path, JSON.stringify(pairing, null, 2), 'utf-8');

    return { valid: true, pairing };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}

/**
 * Clean up expired pairing codes.
 */
export function cleanupPairingCodes(): number {
  try {
    const { readdirSync, unlinkSync } = require('fs');
    if (!existsSync(PAIRING_DIR)) return 0;
    const files = readdirSync(PAIRING_DIR).filter((f: string) => f.endsWith('.json'));
    let cleaned = 0;
    for (const file of files) {
      try {
        const pairing: PairingCode = JSON.parse(readFileSync(join(PAIRING_DIR, file), 'utf-8'));
        if (pairing.used || Date.now() > pairing.expiresAt) {
          unlinkSync(join(PAIRING_DIR, file));
          cleaned++;
        }
      } catch { /* ok */ }
    }
    return cleaned;
  } catch {
    return 0;
  }
}
