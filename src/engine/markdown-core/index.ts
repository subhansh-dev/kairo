/**
 * Markdown core — enhanced markdown parsing and rendering.
 */

export interface MarkdownNode {
  type: 'heading' | 'paragraph' | 'code_block' | 'list' | 'list_item' | 'blockquote' | 'link' | 'image' | 'text' | 'strong' | 'em' | 'hr' | 'table';
  content?: string;
  level?: number;
  children?: MarkdownNode[];
  language?: string;
  url?: string;
  title?: string;
  ordered?: boolean;
}

/**
 * Parse markdown into a simple AST.
 */
export function parseMarkdown(text: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      nodes.push({
        type: 'heading',
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Code block
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push({
        type: 'code_block',
        language,
        content: codeLines.join('\n'),
      });
      i++; // Skip closing ```
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      nodes.push({ type: 'hr' });
      i++;
      continue;
    }

    // List
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)/);
    if (listMatch) {
      const items: MarkdownNode[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.+)/);
        if (!m) break;
        items.push({ type: 'list_item', content: m[3] });
        i++;
      }
      nodes.push({
        type: 'list',
        ordered: /^\d+\./.test(listMatch[2]),
        children: items,
      });
      continue;
    }

    // Blockquote
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      nodes.push({
        type: 'blockquote',
        content: quoteLines.join('\n'),
      });
      continue;
    }

    // Paragraph
    if (line.trim()) {
      const paraLines: string[] = [];
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !lines[i].startsWith('>')) {
        paraLines.push(lines[i]);
        i++;
      }
      nodes.push({
        type: 'paragraph',
        content: paraLines.join(' '),
      });
      continue;
    }

    i++;
  }

  return nodes;
}

/**
 * Extract headings from markdown.
 */
export function extractHeadings(text: string): Array<{ level: number; text: string }> {
  return text
    .split('\n')
    .map(line => {
      const match = line.match(/^(#{1,6})\s+(.+)/);
      return match ? { level: match[1].length, text: match[2] } : null;
    })
    .filter(Boolean) as Array<{ level: number; text: string }>;
}
