/**
 * Kairo — File Safety
 * Shared file safety rules.
 * Ported from Hermes Agent's file_safety.py
 */

import { existsSync } from 'fs';
import { join, resolve, normalize } from 'path';
import { homedir } from 'os';

// ─── Sensitive Paths ────────────────────────────────────────────

const SENSITIVE_PATTERNS = [
  /\.env$/,
  /\.env\./,
  /credentials/i,
  /secret/i,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /id_ed25519/,
  /\.gnupg/,
  /\.ssh\//,
  /\.aws\//,
  /\.kube\//,
  /password/i,
  /token/i,
];

const PROTECTED_DIRS = [
  join(homedir(), '.ssh'),
  join(homedir(), '.gnupg'),
  join(homedir(), '.aws'),
  join(homedir(), '.kube'),
];

const ALWAYS_READABLE = [
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'Cargo.toml',
  'go.mod',
  'README.md',
  'LICENSE',
];

// ─── Safety Checks ──────────────────────────────────────────────

/**
 * Check if a file path is safe to read.
 */
export function checkReadSafety(filePath: string): { allowed: boolean; reason?: string } {
  const normalized = normalize(resolve(filePath));

  // Always allow reading common project files
  const basename = normalized.split(/[/\\]/).pop() || '';
  if (ALWAYS_READABLE.includes(basename)) return { allowed: true };

  // Check protected directories
  for (const dir of PROTECTED_DIRS) {
    if (normalized.startsWith(dir)) {
      return { allowed: false, reason: `Reading from protected directory: ${dir}` };
    }
  }

  return { allowed: true };
}

/**
 * Check if a file path is safe to write.
 */
export function checkWriteSafety(filePath: string): { allowed: boolean; reason?: string } {
  const normalized = normalize(resolve(filePath));

  // Never write to sensitive files
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      return { allowed: false, reason: `Cannot write to sensitive file: ${filePath}` };
    }
  }

  // Never write outside workspace
  const workspace = process.cwd();
  if (!normalized.startsWith(normalize(resolve(workspace)))) {
    return { allowed: false, reason: `Cannot write outside workspace: ${filePath}` };
  }

  // Check protected directories
  for (const dir of PROTECTED_DIRS) {
    if (normalized.startsWith(dir)) {
      return { allowed: false, reason: `Cannot write to protected directory: ${dir}` };
    }
  }

  return { allowed: true };
}

/**
 * Check if a shell command is safe to execute.
 */
export function checkExecSafety(command: string): { allowed: boolean; reason?: string } {
  const lower = command.toLowerCase().trim();

  // Destructive commands
  const destructive = [
    /\brm\s+-rf?\s+\//, // rm -rf /
    /\bmkfs\b/,         // format disk
    /\bdd\s+if=/,       // raw disk write
    />\s*\/dev\/sd/,    // write to block device
    /\bshutdown\b/,
    /\breboot\b/,
    /\binit\s+0\b/,
  ];

  for (const pattern of destructive) {
    if (pattern.test(lower)) {
      return { allowed: false, reason: `Destructive command blocked: ${command}` };
    }
  }

  // Credential exfiltration
  if (lower.includes('curl') && (lower.includes('.ssh') || lower.includes('.env') || lower.includes('password'))) {
    return { allowed: false, reason: 'Potential credential exfiltration blocked' };
  }

  return { allowed: true };
}
