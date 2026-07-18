/**
 * Feishu doc — Feishu/Lark document operations.
 */

export interface FeishuDocBlock {
  type: string;
  content: string;
  style?: Record<string, unknown>;
}

/**
 * Build a Feishu document create request.
 */
export function buildFeishuDocCreateRequest(title: string, folderToken?: string): Record<string, unknown> {
  return {
    title,
    folder_token: folderToken,
  };
}

/**
 * Build a Feishu document update request.
 */
export function buildFeishuDocUpdateRequest(documentId: string, blocks: FeishuDocBlock[]): Record<string, unknown> {
  return {
    document_id: documentId,
    blocks,
  };
}

/**
 * Format a Feishu document block for display.
 */
export function formatFeishuDocBlock(block: FeishuDocBlock): string {
  switch (block.type) {
    case 'heading': return `## ${block.content}`;
    case 'paragraph': return block.content;
    case 'code': return `\`\`\`\n${block.content}\n\`\`\``;
    case 'list': return `• ${block.content}`;
    default: return block.content;
  }
}

/**
 * Parse markdown to Feishu document blocks.
 */
export function markdownToFeishuBlocks(markdown: string): FeishuDocBlock[] {
  const blocks: FeishuDocBlock[] = [];
  const lines = markdown.split('\n');

  for (const line of lines) {
    if (line.startsWith('# ')) blocks.push({ type: 'heading', content: line.slice(2) });
    else if (line.startsWith('## ')) blocks.push({ type: 'heading', content: line.slice(3) });
    else if (line.startsWith('- ')) blocks.push({ type: 'list', content: line.slice(2) });
    else if (line.trim()) blocks.push({ type: 'paragraph', content: line });
  }

  return blocks;
}
