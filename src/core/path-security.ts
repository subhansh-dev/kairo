/**
 * Path security — check file paths for safety.
 */

import { resolve, normalize, isAbsolute } from 'path';

const SENSITIVE_PATHS = [
  '/etc/shadow', '/etc/passwd', '/etc/sudoers',
  '~/.ssh', '~/.gnupg', '~/.aws', '~/.config/gcloud',
  '/proc', '/sys', '/dev',
];

const BLOCKED_PATHS = [
  '/etc/shadow', '/etc/sudoers',
];

/**
 * Check if a path is safe to read.
 */
export function isPathSafeToRead(path: string, allowedRoot?: string): { safe: boolean; reason?: string } {
  const normalized = normalize(resolve(path));

  // Block paths that should never be read
  for (const blocked of BLOCKED_PATHS) {
    if (normalized.startsWith(blocked)) {
      return { safe: false, reason: `Blocked sensitive path: ${blocked}` };
    }
  }

  // Warn about sensitive paths
  for (const sensitive of SENSITIVE_PATHS) {
    const expanded = sensitive.replace(/^~/, process.env.HOME || '');
    if (normalized.startsWith(expanded)) {
      return { safe: true, reason: `Warning: sensitive path (${sensitive})` };
    }
  }

  // Check against allowed root if specified
  if (allowedRoot) {
    const root = normalize(resolve(allowedRoot));
    if (!normalized.startsWith(root)) {
      return { safe: false, reason: `Path outside allowed root: ${allowedRoot}` };
    }
  }

  return { safe: true };
}

/**
 * Check if a path is safe to write.
 */
export function isPathSafeToWrite(path: string, allowedRoot?: string): { safe: boolean; reason?: string } {
  const normalized = normalize(resolve(path));

  // Block writing to system paths
  const systemPaths = ['/etc', '/usr', '/bin', '/sbin', '/lib', '/var'];
  for (const sysPath of systemPaths) {
    if (normalized.startsWith(sysPath + '/') || normalized === sysPath) {
      return { safe: false, reason: `Blocked system path: ${sysPath}` };
    }
  }

  // Block writing to sensitive paths
  for (const blocked of BLOCKED_PATHS) {
    if (normalized.startsWith(blocked)) {
      return { safe: false, reason: `Blocked sensitive path: ${blocked}` };
    }
  }

  // Check against allowed root if specified
  if (allowedRoot) {
    const root = normalize(resolve(allowedRoot));
    if (!normalized.startsWith(root)) {
      return { safe: false, reason: `Path outside allowed root: ${allowedRoot}` };
    }
  }

  return { safe: true };
}

/**
 * Sanitize a file path for safe use.
 */
export function sanitizePath(path: string): string {
  // Remove null bytes
  let sanitized = path.replace(/\0/g, '');
  // Normalize
  sanitized = normalize(sanitized);
  return sanitized;
}
