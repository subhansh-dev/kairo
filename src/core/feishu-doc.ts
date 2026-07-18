/**
 * Feishu doc — Feishu/Lark document integration.
 */

export interface FeishuDoc {
  id: string;
  title: string;
  content: string;
  url: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Build a Feishu document request.
 */
export function buildFeishuDocRequest(title: string, content: string): Record<string, unknown> {
  return {
    title,
    content,
    folder_token: '',
  };
}

/**
 * Format a Feishu document for display.
 */
export function formatFeishuDoc(doc: FeishuDoc): string {
  const time = new Date(doc.updatedAt).toLocaleString();
  return `📄 ${doc.title} (${time})\n${doc.url}`;
}

/**
 * Parse Feishu document content.
 */
export function parseFeishuContent(content: string): { text: string; images: string[]; links: string[] } {
  const text = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const images: string[] = [];
  const links: string[] = [];

  const imgMatches = content.matchAll(/!\[.*?\]\((.*?)\)/g);
  for (const match of imgMatches) images.push(match[1]);

  const linkMatches = content.matchAll(/\[.*?\]\((.*?)\)/g);
  for (const match of linkMatches) links.push(match[1]);

  return { text, images, links };
}
