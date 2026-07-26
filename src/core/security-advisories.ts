/**
 * Security advisories — check for known security advisories.
 */

export interface Advisory {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  description: string;
  affectedVersions: string[];
  fixedVersion?: string;
  reference?: string;
}

// Known advisories (would be fetched from a server in production)
const KNOWN_ADVISORIES: Advisory[] = [];

/**
 * Check for advisories affecting the current version.
 */
export function checkAdvisories(version: string): Advisory[] {
  return KNOWN_ADVISORIES.filter(a => a.affectedVersions.includes(version));
}

/**
 * Format advisories for display.
 */
export function formatAdvisories(advisories: Advisory[]): string {
  if (advisories.length === 0) return 'No known security advisories.';

  const severityIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
  return advisories.map(a =>
    `${severityIcon[a.severity]} ${a.id}: ${a.title}\n   ${a.description}${a.fixedVersion ? `\n   Fixed in: ${a.fixedVersion}` : ''}`
  ).join('\n\n');
}

/**
 * Check if there are any critical advisories.
 */
export function hasCriticalAdvisories(version: string): boolean {
  return checkAdvisories(version).some(a => a.severity === 'critical');
}
