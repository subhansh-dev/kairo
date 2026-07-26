/**
 * Security audit — check for security issues in the codebase.
 */

export interface SecurityFinding {
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  description: string;
  file?: string;
  line?: number;
  recommendation: string;
}

/**
 * Scan code for common security issues.
 */
export function scanForSecurityIssues(code: string, filename: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  // Check for hardcoded secrets
  const secretPatterns = [
    { pattern: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*['"][^'"]{8,}['"]/gi, category: 'hardcoded_secret' },
    { pattern: /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, category: 'stripe_key' },
    { pattern: /ghp_[A-Za-z0-9]{36}/g, category: 'github_pat' },
    { pattern: /AIza[A-Za-z0-9_-]{35}/g, category: 'google_api_key' },
  ];

  for (const { pattern, category } of secretPatterns) {
    const matches = code.match(pattern);
    if (matches) {
      findings.push({
        severity: 'high',
        category,
        description: `Potential hardcoded secret found (${matches.length} match(es))`,
        file: filename,
        recommendation: 'Move secrets to environment variables or a secrets manager.',
      });
    }
  }

  // Check for dangerous function calls
  if (code.includes('eval(') || code.includes('new Function(')) {
    findings.push({
      severity: 'high',
      category: 'code_injection',
      description: 'Use of eval() or new Function() detected',
      file: filename,
      recommendation: 'Avoid eval() — use safer alternatives.',
    });
  }

  // Check for SQL injection patterns
  if (/\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE)/i.test(code) || /`.*(?:SELECT|INSERT|UPDATE|DELETE).*\$\{/i.test(code)) {
    findings.push({
      severity: 'high',
      category: 'sql_injection',
      description: 'Potential SQL injection via template literal',
      file: filename,
      recommendation: 'Use parameterized queries instead of string interpolation.',
    });
  }

  // Check for command injection
  if (/(?:exec|spawn|execSync)\s*\(.*\$\{/i.test(code)) {
    findings.push({
      severity: 'medium',
      category: 'command_injection',
      description: 'Potential command injection via template literal',
      file: filename,
      recommendation: 'Sanitize inputs before passing to shell commands.',
    });
  }

  return findings;
}

/**
 * Format security findings for display.
 */
export function formatSecurityFindings(findings: SecurityFinding[]): string {
  if (findings.length === 0) return 'No security issues found.';

  const severityIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
  return findings.map(f =>
    `${severityIcon[f.severity]} [${f.severity.toUpperCase()}] ${f.category}: ${f.description}\n   → ${f.recommendation}`
  ).join('\n\n');
}
