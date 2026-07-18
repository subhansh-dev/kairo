export function truncate(str: string, maxLen: number, ellipsis: string = '...'): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - ellipsis.length) + ellipsis;
}

export function truncateMiddle(str: string, maxLen: number, ellipsis: string = '...'): string {
  if (str.length <= maxLen) return str;
  const half = Math.floor((maxLen - ellipsis.length) / 2);
  return str.slice(0, half) + ellipsis + str.slice(str.length - half);
}

export function indent(text: string, level: number = 1, char: string = '  '): string {
  const prefix = char.repeat(level);
  return text.split('\n').map(line => prefix + line).join('\n');
}

export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

export function wordWrap(text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length <= maxWidth) {
      lines.push(paragraph);
      continue;
    }
    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      if (current.length + word.length + 1 > maxWidth) {
        if (current) lines.push(current);
        current = word;
      } else {
        current = current ? current + ' ' + word : word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export function escapeRegex(str: string): string {
  return str.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function pluralize(n: number, singular: string, plural?: string): string {
  return n === 1 ? singular : (plural || singular + 's');
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function findSimilar(str: string, candidates: string[], threshold: number = 3): string[] {
  return candidates
    .map(c => ({ candidate: c, distance: levenshteinDistance(str, c) }))
    .filter(x => x.distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
    .map(x => x.candidate);
}
