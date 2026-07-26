/**
 * Doctor — diagnose common issues with the Kairo installation.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  fix?: string;
}

/**
 * Run all diagnostic checks.
 */
export async function runDoctorChecks(): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];

  // Check Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  checks.push({
    name: 'Node.js version',
    status: major >= 18 ? 'ok' : 'warning',
    message: `Node.js ${nodeVersion}`,
    fix: major < 18 ? 'Upgrade to Node.js 18 or later' : undefined,
  });

  // Check config directory
  const configDir = join(homedir(), '.kairo');
  checks.push({
    name: 'Config directory',
    status: existsSync(configDir) ? 'ok' : 'warning',
    message: existsSync(configDir) ? `Found at ${configDir}` : 'Not found',
    fix: !existsSync(configDir) ? 'Run `kairo --init` to create config' : undefined,
  });

  // Check models.yml
  const modelsFile = join(configDir, 'models.yml');
  checks.push({
    name: 'Models config',
    status: existsSync(modelsFile) ? 'ok' : 'warning',
    message: existsSync(modelsFile) ? 'Found' : 'Not found',
    fix: !existsSync(modelsFile) ? 'Create ~/.kairo/models.yml with provider API keys' : undefined,
  });

  // Check API keys
  const hasNvidia = !!process.env.NVIDIA_API_KEY;
  const hasGroq = !!process.env.GROQ_API_KEY;
  const hasCerebras = !!process.env.CEREBRAS_API_KEY;
  const keyCount = [hasNvidia, hasGroq, hasCerebras].filter(Boolean).length;
  checks.push({
    name: 'API keys',
    status: keyCount > 0 ? 'ok' : 'error',
    message: `${keyCount} provider key(s) found in environment`,
    fix: keyCount === 0 ? 'Set NVIDIA_API_KEY, GROQ_API_KEY, or CEREBRAS_API_KEY' : undefined,
  });

  // Check TypeScript
  try {
    const { execSync } = require('child_process');
    execSync('npx tsc --version', { stdio: 'pipe', timeout: 10000 });
    checks.push({ name: 'TypeScript', status: 'ok', message: 'Available' });
  } catch {
    checks.push({ name: 'TypeScript', status: 'warning', message: 'Not found', fix: 'Run npm install' });
  }

  return checks;
}

/**
 * Format doctor checks for display.
 */
export function formatDoctorChecks(checks: DoctorCheck[]): string {
  const icon = { ok: '✅', warning: '⚠️', error: '❌' };
  const lines = checks.map(c => {
    let line = `${icon[c.status]} ${c.name}: ${c.message}`;
    if (c.fix) line += `\n   Fix: ${c.fix}`;
    return line;
  });

  const errors = checks.filter(c => c.status === 'error').length;
  const warnings = checks.filter(c => c.status === 'warning').length;
  const summary = errors > 0 ? `\n${errors} error(s), ${warnings} warning(s)` : warnings > 0 ? `\n${warnings} warning(s)` : '\nAll checks passed!';

  return lines.join('\n') + summary;
}
