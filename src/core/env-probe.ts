/**
 * Environment probing — detect available tools and capabilities.
 */

export interface EnvProbeResult {
  nodeVersion: string;
  npmVersion: string | null;
  gitVersion: string | null;
  dockerVersion: string | null;
  pythonVersion: string | null;
  shell: string;
  platform: string;
  arch: string;
  hasTypeScript: boolean;
  hasEslint: boolean;
  hasPrettier: boolean;
  hasVitest: boolean;
  hasJest: boolean;
  cwd: string;
}

/**
 * Probe the environment for available tools and capabilities.
 */
export async function probeEnvironment(): Promise<EnvProbeResult> {
  const { execSync } = require('child_process');
  const run = (cmd: string): string | null => {
    try { return execSync(cmd, { encoding: 'utf-8', timeout: 5000 }).trim(); } catch { return null; }
  };

  return {
    nodeVersion: process.version,
    npmVersion: run('npm --version'),
    gitVersion: run('git --version'),
    dockerVersion: run('docker --version'),
    pythonVersion: run('python3 --version') || run('python --version'),
    shell: process.env.SHELL || '/bin/sh',
    platform: process.platform,
    arch: process.arch,
    hasTypeScript: !!run('npx tsc --version'),
    hasEslint: !!run('npx eslint --version'),
    hasPrettier: !!run('npx prettier --version'),
    hasVitest: !!run('npx vitest --version'),
    hasJest: !!run('npx jest --version'),
    cwd: process.cwd(),
  };
}

/**
 * Check if a command is available in PATH.
 */
export function isCommandAvailable(command: string): boolean {
  try {
    const { execSync } = require('child_process');
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    execSync(`${cmd} ${command}`, { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get available package managers.
 */
export function getAvailablePackageManagers(): string[] {
  const managers: string[] = [];
  for (const pm of ['npm', 'yarn', 'pnpm', 'bun']) {
    if (isCommandAvailable(pm)) managers.push(pm);
  }
  return managers;
}
