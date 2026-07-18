/**
 * Auto-update checker — checks for new versions.
 */

const VERSION = '0.3.0';

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion?: string;
  downloadUrl?: string;
  releaseNotes?: string;
  checkedAt: Date;
}

/**
 * Check for updates.
 * Stub implementation — can be extended to check GitHub releases.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  return {
    hasUpdate: false,
    currentVersion: VERSION,
    checkedAt: new Date(),
  };
}

/**
 * Format an update check result for display.
 */
export function formatUpdateResult(result: UpdateCheckResult): string {
  if (!result.hasUpdate) {
    return `You're running the latest version (${result.currentVersion}).`;
  }
  return `Update available: ${result.currentVersion} → ${result.latestVersion}\n${result.downloadUrl ?? ''}`;
}
