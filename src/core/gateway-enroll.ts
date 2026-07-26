/**
 * Gateway enroll — gateway device enrollment.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes } from 'crypto';

export interface EnrollmentToken {
  token: string;
  deviceId?: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
}

const ENROLLMENT_DIR = join(homedir(), '.kairo', 'enrollment');

/**
 * Generate an enrollment token.
 */
export function generateEnrollmentToken(deviceId?: string, ttlMs = 300_000): EnrollmentToken {
  const token = randomBytes(32).toString('hex');
  const enrollment: EnrollmentToken = {
    token,
    deviceId,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
    used: false,
  };

  try {
    if (!existsSync(ENROLLMENT_DIR)) mkdirSync(ENROLLMENT_DIR, { recursive: true });
    writeFileSync(join(ENROLLMENT_DIR, `${token.slice(0, 8)}.json`), JSON.stringify(enrollment, null, 2), 'utf-8');
  } catch { /* best-effort */ }

  return enrollment;
}

/**
 * Validate an enrollment token.
 */
export function validateEnrollmentToken(token: string): { valid: boolean; enrollment?: EnrollmentToken; error?: string } {
  try {
    const path = join(ENROLLMENT_DIR, `${token.slice(0, 8)}.json`);
    if (!existsSync(path)) return { valid: false, error: 'Token not found' };

    const enrollment: EnrollmentToken = JSON.parse(readFileSync(path, 'utf-8'));
    if (enrollment.used) return { valid: false, error: 'Token already used' };
    if (Date.now() > enrollment.expiresAt) return { valid: false, error: 'Token expired' };
    if (enrollment.token !== token) return { valid: false, error: 'Invalid token' };

    enrollment.used = true;
    writeFileSync(path, JSON.stringify(enrollment, null, 2), 'utf-8');

    return { valid: true, enrollment };
  } catch (err: any) {
    return { valid: false, error: err.message };
  }
}
