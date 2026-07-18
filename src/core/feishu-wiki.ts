/**
 * Feishu wiki — Feishu/Lark wiki integration.
 */

export interface FeishuWikiNode {
  id: string;
  title: string;
  type: 'doc' | 'folder';
  parentId?: string;
  url: string;
  children?: FeishuWikiNode[];
}

/**
 * Format a Feishu wiki node for display.
 */
export function formatFeishuWikiNode(node: FeishuWikiNode, indent = 0): string {
  const prefix = '  '.repeat(indent);
  const icon = node.type === 'folder' ? '📁' : '📄';
  let result = `${prefix}${icon} ${node.title}`;

  if (node.children && node.children.length > 0) {
    result += '\n' + node.children.map(c => formatFeishuWikiNode(c, indent + 1)).join('\n');
  }

  return result;
}

/**
 * Build a Feishu wiki list request.
 */
export function buildFeishuWikiRequest(spaceId: string, parentNodeToken?: string): Record<string, unknown> {
  return {
    space_id: spaceId,
    parent_node_token: parentNodeToken,
  };
}
