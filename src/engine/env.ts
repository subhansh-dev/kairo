/**
 * Environment detection — identifies runtime environment and capabilities.
 */

export interface EnvInfo {
  platform: 'windows' | 'macos' | 'linux' | 'unknown';
  shell: string;
  editor?: string;
  ci: boolean;
  remote: boolean;
  wsl: boolean;
  npmPath?: string;
}

/**
 * Detect the current runtime environment.
 */
export function detectEnvironment(): EnvInfo {
  const platform = detectPlatform();
  const shell = detectShell();
  const ci = !!process.env.CI;
  const remote = !!process.env.SSH_TTY || !!process.env.REMOTE_SESSION;
  const wsl = detectWSL();

  return {
    platform,
    shell,
    ci,
    remote,
    wsl,
  };
}

function detectPlatform(): EnvInfo['platform'] {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'macos';
    case 'linux': return 'linux';
    default: return 'unknown';
  }
}

function detectShell(): string {
  if (process.env.SHELL) return process.env.SHELL;
  if (process.platform === 'win32') return process.env.ComSpec || 'cmd.exe';
  return '/bin/sh';
}

function detectWSL(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    const fs = require('fs');
    return fs.existsSync('/proc/version') &&
           fs.readFileSync('/proc/version', 'utf-8').toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

/**
 * Get environment presets for common configurations.
 */
export function getEnvironmentPresets(): Record<string, Partial<EnvInfo>> {
  return {
    github_actions: { ci: true, remote: true, platform: 'linux' },
    vscode_remote: { remote: true },
    wsl: { wsl: true, platform: 'linux' },
  };
}
