/**
 * Profile — user profile management.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface UserProfile {
  name: string;
  preferences: Record<string, unknown>;
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

const PROFILES_DIR = join(homedir(), '.kairo', 'profiles');

/**
 * Load a profile.
 */
export function loadProfile(name: string): UserProfile | null {
  try {
    const path = join(PROFILES_DIR, `${name}.json`);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Save a profile.
 */
export function saveProfile(profile: UserProfile): void {
  try {
    if (!existsSync(PROFILES_DIR)) mkdirSync(PROFILES_DIR, { recursive: true });
    profile.updatedAt = Date.now();
    writeFileSync(join(PROFILES_DIR, `${profile.name}.json`), JSON.stringify(profile, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Create a new profile.
 */
export function createProfile(name: string): UserProfile {
  const profile: UserProfile = {
    name,
    preferences: {},
    settings: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveProfile(profile);
  return profile;
}

/**
 * List all profiles.
 */
export function listProfiles(): string[] {
  try {
    const { readdirSync } = require('fs');
    if (!existsSync(PROFILES_DIR)) return [];
    return readdirSync(PROFILES_DIR)
      .filter((f: string) => f.endsWith('.json'))
      .map((f: string) => f.slice(0, -5));
  } catch {
    return [];
  }
}

/**
 * Delete a profile.
 */
export function deleteProfile(name: string): boolean {
  try {
    const { unlinkSync } = require('fs');
    const path = join(PROFILES_DIR, `${name}.json`);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Update profile preferences.
 */
export function updatePreferences(name: string, prefs: Record<string, unknown>): boolean {
  const profile = loadProfile(name);
  if (!profile) return false;
  profile.preferences = { ...profile.preferences, ...prefs };
  saveProfile(profile);
  return true;
}
