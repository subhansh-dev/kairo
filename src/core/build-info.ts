/**
 * Build info — compile-time build information.
 */

export interface BuildInfo {
  version: string;
  buildTime: string;
  gitHash?: string;
  nodeVersion: string;
  platform: string;
  arch: string;
}

/**
 * Get build information.
 */
export function getBuildInfo(): BuildInfo {
  return {
    version: getVersion(),
    buildTime: getBuildTime(),
    gitHash: getGitHash(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

/**
 * Get the version from package.json.
 */
function getVersion(): string {
  try {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Get the build time (or current time as fallback).
 */
function getBuildTime(): string {
  try {
    const { statSync } = require('fs');
    const { join } = require('path');
    const stat = statSync(join(__dirname, '../../package.json'));
    return stat.mtime.toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/**
 * Get the git hash of the current commit.
 */
function getGitHash(): string | undefined {
  try {
    const { execSync } = require('child_process');
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8', stdio: 'pipe' }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Format build info for display.
 */
export function formatBuildInfo(info: BuildInfo): string {
  return [
    `Version: ${info.version}`,
    `Node.js: ${info.nodeVersion}`,
    `Platform: ${info.platform}/${info.arch}`,
    info.gitHash ? `Git: ${info.gitHash}` : null,
    `Built: ${info.buildTime}`,
  ].filter(Boolean).join(' | ');
}
