/**
 * Credential files — manage credential file operations.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CREDENTIAL_DIR = join(homedir(), '.kairo', 'credentials');

/**
 * Store a credential to a file.
 */
export function storeCredential(name: string, value: string): boolean {
  try {
    if (!existsSync(CREDENTIAL_DIR)) mkdirSync(CREDENTIAL_DIR, { recursive: true });
    const path = join(CREDENTIAL_DIR, `${name}.txt`);
    writeFileSync(path, value, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Load a credential from a file.
 */
export function loadCredential(name: string): string | null {
  try {
    const path = join(CREDENTIAL_DIR, `${name}.txt`);
    if (!existsSync(path)) return null;
    return readFileSync(path, 'utf-8').trim();
  } catch {
    return null;
  }
}

/**
 * Delete a credential file.
 */
export function deleteCredential(name: string): boolean {
  try {
    const { unlinkSync } = require('fs');
    const path = join(CREDENTIAL_DIR, `${name}.txt`);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * List all stored credential names.
 */
export function listCredentials(): string[] {
  try {
    const { readdirSync } = require('fs');
    if (!existsSync(CREDENTIAL_DIR)) return [];
    return readdirSync(CREDENTIAL_DIR)
      .filter((f: string) => f.endsWith('.txt'))
      .map((f: string) => f.slice(0, -4));
  } catch {
    return [];
  }
}

/**
 * Check if a credential exists.
 */
export function hasCredential(name: string): boolean {
  return existsSync(join(CREDENTIAL_DIR, `${name}.txt`));
}
