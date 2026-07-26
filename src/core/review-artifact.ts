/**
 * Review artifact — code review artifact utilities.
 */

export interface ReviewArtifact {
  type: 'code' | 'config' | 'documentation' | 'test' | 'architecture';
  path?: string;
  content: string;
  findings: ReviewFinding[];
  summary: string;
  verdict: 'approve' | 'request_changes' | 'comment';
}

export interface ReviewFinding {
  severity: 'info' | 'warning' | 'error';
  line?: number;
  message: string;
  suggestion?: string;
}

/**
 * Build a review artifact.
 */
export function buildReviewArtifact(opts: {
  type: ReviewArtifact['type'];
  path?: string;
  content: string;
  findings: ReviewFinding[];
  summary: string;
  verdict: ReviewArtifact['verdict'];
}): ReviewArtifact {
  return opts;
}

/**
 * Format review artifact for display.
 */
export function formatReviewArtifact(review: ReviewArtifact): string {
  const verdictIcon = { approve: '✅', request_changes: '❌', comment: '💬' };
  const lines = [`${verdictIcon[review.verdict]} ${review.summary}`];

  if (review.path) lines.push(`File: ${review.path}`);
  lines.push('');

  if (review.findings.length > 0) {
    const severityIcon = { info: 'ℹ️', warning: '⚠️', error: '❌' };
    for (const finding of review.findings) {
      const lineNum = finding.line ? `:${finding.line}` : '';
      lines.push(`${severityIcon[finding.severity]} ${finding.message}${lineNum}`);
      if (finding.suggestion) lines.push(`   → ${finding.suggestion}`);
    }
  }

  return lines.join('\n');
}

/**
 * Count findings by severity.
 */
export function countFindings(findings: ReviewFinding[]): Record<string, number> {
  const counts = { info: 0, warning: 0, error: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}
