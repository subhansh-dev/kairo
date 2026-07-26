/**
 * Suggest PR — pull request suggestion utilities.
 */

export interface PRSuggestion {
  title: string;
  description: string;
  branch: string;
  baseBranch: string;
  files: string[];
  type: 'feature' | 'fix' | 'refactor' | 'docs' | 'test' | 'chore';
  labels: string[];
}

/**
 * Build a PR suggestion from changes.
 */
export function buildPRSuggestion(opts: {
  title: string;
  description: string;
  files: string[];
  type?: PRSuggestion['type'];
}): PRSuggestion {
  const type = opts.type || 'feature';
  const branchPrefix = { feature: 'feat/', fix: 'fix/', refactor: 'refactor/', docs: 'docs/', test: 'test/', chore: 'chore/' };

  return {
    title: opts.title,
    description: opts.description,
    branch: `${branchPrefix[type]}${opts.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)}`,
    baseBranch: 'main',
    files: opts.files,
    type,
    labels: [type],
  };
}

/**
 * Format PR suggestion for display.
 */
export function formatPRSuggestion(pr: PRSuggestion): string {
  const typeEmoji = { feature: '✨', fix: '🐛', refactor: '♻️', docs: '📝', test: '✅', chore: '🔧' };
  return [
    `${typeEmoji[pr.type]} ${pr.title}`,
    `Branch: ${pr.branch} → ${pr.baseBranch}`,
    `Files: ${pr.files.length}`,
    '',
    pr.description,
  ].join('\n');
}

/**
 * Generate a PR description template.
 */
export function generatePRDescription(title: string, changes: string[]): string {
  return `## ${title}

### Changes
${changes.map(c => `- ${c}`).join('\n')}

### Testing
- [ ] Unit tests pass
- [ ] Manual testing completed

### Checklist
- [ ] Code follows project conventions
- [ ] Documentation updated (if needed)
- [ ] No breaking changes (or documented)`;
}
