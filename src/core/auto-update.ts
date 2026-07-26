/**
 * Auto-update — check for and apply updates.
 */

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  changelog?: string;
}

/**
 * Check for updates.
 */
export async function checkForUpdates(): Promise<UpdateInfo> {
  const currentVersion = getVersion();

  try {
    // In a real implementation, this would check npm registry or GitHub releases
    return {
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
    };
  } catch {
    return {
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
    };
  }
}

/**
 * Format update info for display.
 */
export function formatUpdateInfo(info: UpdateInfo): string {
  if (!info.hasUpdate) {
    return `✅ Kairo v${info.currentVersion} is up to date.`;
  }
  return [
    `🔄 Update available: v${info.currentVersion} → v${info.latestVersion}`,
    info.changelog ? `\nChangelog:\n${info.changelog}` : '',
    '\nRun `npm update -g kairo` to update.',
  ].join('');
}

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
