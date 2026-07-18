/**
 * Kairo — File Safety System
 * Write denylist, read blocklist, path traversal prevention, credential detection
 */

import { existsSync, statSync, realpathSync } from 'fs';
import { resolve, relative, normalize, sep } from 'path';

// ─── Write Denylist (must never write to these paths) ──────

const WRITE_DENYLIST_PATTERNS = [
  /[/\\]\.ssh[/\\]/i,
  /[/\\]\.gnupg[/\\]/i,
  /[/\\]\.aws[/\\]/i,
  /[/\\]\.azure[/\\]/i,
  /[/\\]\.config[/\\]gcloud[/\\]/i,
  /[/\\]\.config[/\\]kairo[/\\]/i,
  /[/\\]\.kairo[/\\]/i,
  /[/\\]node_modules[/\\]/i,
  /[/\\]\.git[/\\]/i,
  /[/\\]__pycache__[/\\]/i,
  /[/\\]\.venv[/\\]/i,
  /[/\\]venv[/\\]/i,
  /\.env$/i,
  /\.env\.\w+$/i,
  /id_rsa$/i,
  /id_ed25519$/i,
  /id_ecdsa$/i,
  /\.netrc$/i,
  /credentials\.json$/i,
  /service-account\.json$/i,
  /token\.json$/i,
  /master\.key$/i,
  /shadow$/i,
  /passwd$/i,
];

// ─── Read Blocklist (should never read these) ─────────────

const READ_BLOCKLIST_PATTERNS = [
  /[/\\]\.ssh[/\\]/i,
  /[/\\]\.gnupg[/\\]/i,
  /[/\\]\.aws[/\\]credentials/i,
  /\.env$/i,
  /\.env\.\w+$/i,
  /id_rsa$/i,
  /id_ed25519$/i,
  /credentials\.json$/i,
  /token\.json$/i,
  /service-account\.json$/i,
  /master\.key$/i,
  /\.kairo[/\\]credentials\.json$/i,
  /\.config[/\\]kairo[/\\]/i,
  /shadow$/i,
  /passwd$/i,
];

// ─── Path Traversal Prevention ────────────────────────────

export function isPathTraversal(filePath: string, baseDir?: string): boolean {
  const normalized = normalize(filePath).replace(/\\/g, '/');
  const base = baseDir ? normalize(baseDir).replace(/\\/g, '/') : process.cwd().replace(/\\/g, '/');

  // Resolve and check if outside base dir
  try {
    const resolved = resolve(base, filePath);
    const rel = relative(base, resolved);
    return rel.startsWith('..');
  } catch {
    return true;
  }
}

// ─── Pattern Matching ─────────────────────────────────────

export function matchesDenylist(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  for (const pattern of WRITE_DENYLIST_PATTERNS) {
    if (pattern.test(normalized)) {
      return `Write denied: ${filePath} matches denylist pattern`;
    }
  }
  return null;
}

export function matchesReadBlocklist(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  for (const pattern of READ_BLOCKLIST_PATTERNS) {
    if (pattern.test(normalized)) {
      return `Read blocked: ${filePath} matches blocklist pattern`;
    }
  }
  return null;
}

// ─── Symlink Safety ───────────────────────────────────────

export function isSymlinkOutsideBase(filePath: string, baseDir?: string): boolean {
  try {
    if (!existsSync(filePath)) return false;
    const stats = statSync(filePath);
    if (!stats.isSymbolicLink()) return false;
    const real = realpathSync(filePath);
    const base = baseDir || process.cwd();
    const rel = relative(base, real);
    return rel.startsWith('..');
  } catch {
    return false;
  }
}

// ─── Content Safety ───────────────────────────────────────

export function contentHasSecrets(content: string): { hasSecrets: boolean; matches: string[] } {
  const patterns: [RegExp, string][] = [
    [/(?:api[_-]?key|apikey)\s*[:=]\s*['"][^'"]{8,}['"]/i, 'API key'],
    [/(?:secret|password|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}['"]/i, 'Secret/password'],
    [/(?:token|bearer)\s*[:=]\s*['"][^'"]{8,}['"]/i, 'Token'],
    [/(?:sk|pk|nvapi|gsk|csk)-[a-zA-Z0-9]{20,}/, 'API key format'],
    [/ghp_[a-zA-Z0-9]{36}/, 'GitHub token'],
    [/gho_[a-zA-Z0-9]{36}/, 'GitHub OAuth token'],
    [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, 'Private key'],
    [/-----BEGIN CERTIFICATE-----/, 'Certificate'],
  ];

  const matches: string[] = [];
  for (const [pattern, label] of patterns) {
    if (pattern.test(content)) matches.push(label);
  }

  return { hasSecrets: matches.length > 0, matches };
}

// ─── Cross-Profile Guard ──────────────────────────────────

export function isCrossProfileAccess(filePath: string, profileName?: string): boolean {
  if (!profileName) return false;
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const profileHome = normalize(process.env.HOME || process.env.USERPROFILE || '').replace(/\\/g, '/').toLowerCase();
  const kairoConfig = profileHome + '/.kairo';

  if (normalized.startsWith(kairoConfig)) {
    // Allow access to current profile's config
    if (profileName && normalized.includes(`profiles/${profileName}`)) return false;
    return true; // Cross-profile access
  }

  return false;
}

// ─── Full Write Check ─────────────────────────────────────

export interface WriteSafetyCheck {
  allowed: boolean;
  reason: string | null;
}

export function checkWriteSafety(filePath: string, content?: string, baseDir?: string): WriteSafetyCheck {
  // Path traversal check
  if (isPathTraversal(filePath, baseDir)) {
    return { allowed: false, reason: 'Path traversal detected' };
  }

  // Denylist check
  const denied = matchesDenylist(filePath);
  if (denied) {
    return { allowed: false, reason: denied };
  }

  // Symlink safety
  if (isSymlinkOutsideBase(filePath, baseDir)) {
    return { allowed: false, reason: 'Symlink points outside base directory' };
  }

  // Content secret check
  if (content) {
    const { hasSecrets, matches } = contentHasSecrets(content);
    if (hasSecrets) {
      return { allowed: false, reason: `Content contains secrets: ${matches.join(', ')}` };
    }
  }

  return { allowed: true, reason: null };
}

export function checkReadSafety(filePath: string, baseDir?: string): WriteSafetyCheck {
  if (isPathTraversal(filePath, baseDir)) {
    return { allowed: false, reason: 'Path traversal detected' };
  }

  const blocked = matchesReadBlocklist(filePath);
  if (blocked) {
    return { allowed: false, reason: blocked };
  }

  return { allowed: true, reason: null };
}
