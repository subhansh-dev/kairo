/**
 * Kairo — Diff Utilities (Kairo-native rewrite)
 *
 * Generate and display diffs between strings.
 */

export interface DiffLine {
  type: 'add' | 'remove' | 'context'
  content: string
  oldLine?: number
  newLine?: number
}

export interface DiffResult {
  lines: DiffLine[]
  additions: number
  deletions: number
  changes: number
}

/**
 * Generate a simple line-by-line diff
 */
export function generateDiff(oldText: string, newText: string): DiffResult {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const lines: DiffLine[] = []

  let additions = 0
  let deletions = 0

  // Simple LCS-based diff
  const lcs = computeLCS(oldLines, newLines)

  let oldIdx = 0
  let newIdx = 0
  let lcsIdx = 0

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (lcsIdx < lcs.length && oldIdx < oldLines.length && newIdx < newLines.length) {
      if (oldLines[oldIdx] === lcs[lcsIdx] && newLines[newIdx] === lcs[lcsIdx]) {
        lines.push({ type: 'context', content: oldLines[oldIdx], oldLine: oldIdx + 1, newLine: newIdx + 1 })
        oldIdx++
        newIdx++
        lcsIdx++
      } else if (oldLines[oldIdx] === lcs[lcsIdx]) {
        lines.push({ type: 'add', content: newLines[newIdx], newLine: newIdx + 1 })
        additions++
        newIdx++
      } else {
        lines.push({ type: 'remove', content: oldLines[oldIdx], oldLine: oldIdx + 1 })
        deletions++
        oldIdx++
      }
    } else if (oldIdx < oldLines.length) {
      lines.push({ type: 'remove', content: oldLines[oldIdx], oldLine: oldIdx + 1 })
      deletions++
      oldIdx++
    } else if (newIdx < newLines.length) {
      lines.push({ type: 'add', content: newLines[newIdx], newLine: newIdx + 1 })
      additions++
      newIdx++
    }
  }

  return { lines, additions, deletions, changes: additions + deletions }
}

function computeLCS(a: string[], b: string[]): string[] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const lcs: string[] = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      lcs.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  return lcs
}

/**
 * Format diff as a string
 */
export function formatDiff(diff: DiffResult, contextLines: number = 3): string {
  const output: string[] = []
  let lastShownIdx = -1

  for (let i = 0; i < diff.lines.length; i++) {
    const line = diff.lines[i]

    // Only show context around changes
    if (line.type === 'context') {
      const hasNearbyChange = diff.lines.slice(
        Math.max(0, i - contextLines),
        Math.min(diff.lines.length, i + contextLines + 1)
      ).some(l => l.type !== 'context')

      if (!hasNearbyChange) {
        if (lastShownIdx === i - 1) {
          output.push('...')
        }
        continue
      }
    }

    lastShownIdx = i

    switch (line.type) {
      case 'add':
        output.push(`+ ${line.content}`)
        break
      case 'remove':
        output.push(`- ${line.content}`)
        break
      case 'context':
        output.push(`  ${line.content}`)
        break
    }
  }

  return output.join('\n')
}

/**
 * Format diff with colors for terminal output
 */
export function formatDiffColored(diff: DiffResult): string {
  const output: string[] = []

  for (const line of diff.lines) {
    switch (line.type) {
      case 'add':
        output.push(`\x1b[32m+ ${line.content}\x1b[0m`)
        break
      case 'remove':
        output.push(`\x1b[31m- ${line.content}\x1b[0m`)
        break
      case 'context':
        output.push(`  ${line.content}`)
        break
    }
  }

  return output.join('\n')
}

/**
 * Check if two strings are different
 */
export function hasChanged(oldText: string, newText: string): boolean {
  return oldText !== newText
}

/**
 * Get a summary of changes
 */
export function getDiffSummary(diff: DiffResult): string {
  if (diff.changes === 0) return 'No changes'
  return `${diff.additions} addition${diff.additions !== 1 ? 's' : ''}, ${diff.deletions} deletion${diff.deletions !== 1 ? 's' : ''}`
}
