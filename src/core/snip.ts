/**
 * Snip — code snippet extraction utilities.
 */

export interface CodeSnippet {
  language: string;
  code: string;
  filename?: string;
  startLine?: number;
  endLine?: number;
}

/**
 * Extract code blocks from markdown text.
 */
export function extractCodeBlocks(markdown: string): CodeSnippet[] {
  const blocks: CodeSnippet[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(markdown)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      code: match[2].trim(),
    });
  }

  return blocks;
}

/**
 * Extract a code snippet from a file.
 */
export function extractSnippet(content: string, startLine: number, endLine: number, filename?: string): CodeSnippet {
  const lines = content.split('\n');
  const snippet = lines.slice(startLine - 1, endLine).join('\n');
  const ext = filename?.split('.').pop() || '';
  const language = extToLanguage(ext);

  return {
    language,
    code: snippet,
    filename,
    startLine,
    endLine,
  };
}

/**
 * Format a code snippet for display.
 */
export function formatSnippet(snippet: CodeSnippet): string {
  const header = snippet.filename
    ? `${snippet.filename}${snippet.startLine ? `:${snippet.startLine}-${snippet.endLine}` : ''}`
    : snippet.language;
  return `\`\`\`${snippet.language}\n${snippet.code}\n\`\`\``;
}

function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', cs: 'csharp',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', html: 'html', css: 'css', sh: 'bash',
    sql: 'sql', graphql: 'graphql',
  };
  return map[ext] || ext || 'text';
}
