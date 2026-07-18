/**
 * Markdown rendering utilities.
 */

/**
 * Strip markdown formatting to plain text.
 */
export function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/!\[.*?\]\(.+?\)/g, '')
    .replace(/^[-*+]\s/gm, '')
    .replace(/^\d+\.\s/gm, '')
    .replace(/^>\s/gm, '')
    .replace(/---+/g, '')
    .replace(/\|/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract code blocks from markdown.
 */
export function extractCodeBlocks(md: string): Array<{ lang: string; code: string }> {
  const blocks: Array<{ lang: string; code: string }> = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match;

  while ((match = regex.exec(md)) !== null) {
    blocks.push({ lang: match[1], code: match[2].trim() });
  }

  return blocks;
}

/**
 * Count words in markdown text.
 */
export function countWords(md: string): number {
  return stripMarkdown(md).split(/\s+/).filter(Boolean).length;
}

/**
 * Extract links from markdown.
 */
export function extractLinks(md: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  const regex = /\[(.+?)\]\((.+?)\)/g;
  let match;

  while ((match = regex.exec(md)) !== null) {
    links.push({ text: match[1], url: match[2] });
  }

  return links;
}
