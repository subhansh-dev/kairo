/**
 * OSV check — Open Source Vulnerability checking.
 */

export interface OSVVulnerability {
  id: string;
  summary: string;
  severity: string;
  affected: string[];
  fixedIn?: string;
  reference?: string;
}

export interface OSVCheckResult {
  package: string;
  version: string;
  vulnerabilities: OSVVulnerability[];
  checked: boolean;
  error?: string;
}

/**
 * Build an OSV API request.
 */
export function buildOSVRequest(packageName: string, version: string): Record<string, unknown> {
  return {
    package: {
      name: packageName,
      ecosystem: 'npm',
    },
    version,
  };
}

/**
 * Format OSV check results for display.
 */
export function formatOSVResults(result: OSVCheckResult): string {
  if (result.error) return `Error checking ${result.package}: ${result.error}`;
  if (result.vulnerabilities.length === 0) return `✅ ${result.package}@${result.version}: No known vulnerabilities`;

  const lines = [`⚠️  ${result.package}@${result.version}: ${result.vulnerabilities.length} vulnerability(ies)`];
  for (const vuln of result.vulnerabilities) {
    lines.push(`  • ${vuln.id}: ${vuln.summary} (${vuln.severity})`);
    if (vuln.fixedIn) lines.push(`    Fixed in: ${vuln.fixedIn}`);
  }
  return lines.join('\n');
}

/**
 * Check if a vulnerability is critical.
 */
export function isCriticalVulnerability(vuln: OSVVulnerability): boolean {
  return vuln.severity === 'CRITICAL' || vuln.severity === 'HIGH';
}

/**
 * Get severity color for display.
 */
export function getSeverityColor(severity: string): string {
  const colors: Record<string, string> = {
    CRITICAL: '\x1b[31m',
    HIGH: '\x1b[31m',
    MEDIUM: '\x1b[33m',
    LOW: '\x1b[32m',
  };
  return colors[severity.toUpperCase()] || '\x1b[0m';
}
