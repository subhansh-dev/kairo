/**
 * Version information and display.
 */

export const VERSION = '0.3.0';
export const CODENAME = 'kairo';

export interface VersionInfo {
  version: string;
  codename: string;
  buildDate?: string;
  gitCommit?: string;
}

/**
 * Get full version info.
 */
export function getVersionInfo(): VersionInfo {
  return {
    version: VERSION,
    codename: CODENAME,
    buildDate: process.env.KAIRO_BUILD_DATE,
    gitCommit: process.env.KAIRO_GIT_COMMIT,
  };
}

/**
 * Format version string for display.
 */
export function formatVersion(info: VersionInfo = getVersionInfo()): string {
  let s = `${info.codename} v${info.version}`;
  if (info.gitCommit) s += ` (${info.gitCommit.slice(0, 7)})`;
  return s;
}
