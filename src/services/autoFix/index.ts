/**
 * Kairo — Auto-Fix System (Kairo-native rewrite)
 *
 * Automatically fix common errors in generated code.
 */

export interface AutoFixRule {
  id: string
  description: string
  pattern: RegExp
  replacement: string | ((match: string, ...args: string[]) => string)
  languages?: string[] // If set, only apply to these languages
}

const DEFAULT_RULES: AutoFixRule[] = [
  // TypeScript/JavaScript
  {
    id: 'ts-any-type',
    description: 'Replace "any" with "unknown" for type safety',
    pattern: /:\s*any\b/g,
    replacement: ': unknown',
    languages: ['ts', 'tsx', 'js', 'jsx'],
  },
  {
    id: 'ts-ignore',
    description: 'Remove @ts-ignore comments',
    pattern: /\/\/\s*@ts-ignore\s*\n/g,
    replacement: '',
    languages: ['ts', 'tsx'],
  },
  {
    id: 'console-log',
    description: 'Remove console.log statements',
    pattern: /console\.log\(.*\);?\s*\n/g,
    replacement: '',
    languages: ['ts', 'tsx', 'js', 'jsx'],
  },
  {
    id: 'todo-fixme',
    description: 'Highlight TODO/FIXME comments',
    pattern: /(TODO|FIXME|HACK|XXX):/g,
    replacement: '⚠ $1:',
  },

  // Python
  {
    id: 'py-print',
    description: 'Remove print statements',
    pattern: /^\s*print\(.*\)\s*\n/gm,
    replacement: '',
    languages: ['py'],
  },

  // General
  {
    id: 'trailing-whitespace',
    description: 'Remove trailing whitespace',
    pattern: /[ \t]+$/gm,
    replacement: '',
  },
  {
    id: 'multiple-blank-lines',
    description: 'Collapse multiple blank lines',
    pattern: /\n{3,}/g,
    replacement: '\n\n',
  },
]

export interface AutoFixResult {
  file: string
  fixes: Array<{ rule: string; description: string; line?: number }>
  original: string
  fixed: string
  changed: boolean
}

/**
 * Apply auto-fix rules to code
 */
export function autoFixCode(
  code: string,
  language?: string,
  rules: AutoFixRule[] = DEFAULT_RULES,
): { code: string; fixes: string[] } {
  let fixed = code
  const fixes: string[] = []

  for (const rule of rules) {
    // Skip if language-specific and doesn't match
    if (rule.languages && language && !rule.languages.includes(language)) continue

    const before = fixed
    if (typeof rule.replacement === 'string') {
      fixed = fixed.replace(rule.pattern, rule.replacement)
    } else {
      fixed = fixed.replace(rule.pattern, rule.replacement)
    }

    if (fixed !== before) {
      fixes.push(rule.description)
    }
  }

  return { code: fixed, fixes }
}

/**
 * Auto-fix a file
 */
export function autoFixFile(
  filepath: string,
  content: string,
  rules?: AutoFixRule[],
): AutoFixResult {
  const ext = filepath.split('.').pop() || ''
  const { code: fixed, fixes } = autoFixCode(content, ext, rules)

  return {
    file: filepath,
    fixes: fixes.map(f => ({ rule: f, description: f })),
    original: content,
    fixed,
    changed: content !== fixed,
  }
}

/**
 * Check if code has common issues
 */
export function hasCommonIssues(code: string, language?: string): string[] {
  const issues: string[] = []

  if (code.includes('any') && ['ts', 'tsx'].includes(language || '')) {
    issues.push('Contains "any" types')
  }
  if (code.includes('// @ts-ignore')) {
    issues.push('Contains @ts-ignore')
  }
  if (code.includes('console.log')) {
    issues.push('Contains console.log')
  }
  if (code.includes('TODO')) {
    issues.push('Contains TODO')
  }
  if (code.includes('FIXME')) {
    issues.push('Contains FIXME')
  }

  return issues
}
