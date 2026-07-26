/**
 * Message content utilities — flatten multimodal content to plain text.
 */

const NON_TEXT_PART_TYPES = new Set(['image', 'image_url', 'input_image', 'audio', 'input_audio']);
const TEXT_KEYS = ['text', 'content', 'input_text', 'output_text', 'summary_text'];

function textFromPart(part: unknown): string {
  if (part === null || part === undefined) return '';
  if (typeof part === 'string') return part;

  const obj = part as Record<string, unknown>;
  const partType = String(obj.type || '').trim().toLowerCase();
  if (NON_TEXT_PART_TYPES.has(partType)) return '';

  for (const key of TEXT_KEYS) {
    const text = obj[key];
    if (typeof text === 'string') return text;
  }
  return '';
}

/**
 * Return the visible text from common chat message content shapes.
 * Handles string content, multimodal arrays, and objects.
 */
export function flattenMessageText(content: unknown, sep = '\n'): string {
  if (content === null || content === undefined) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const chunks = content.map(textFromPart).filter(Boolean);
    return chunks.join(sep);
  }
  const text = textFromPart(content);
  if (text) return text;
  try { return String(content); } catch { return ''; }
}

/**
 * Extract just the text content from a message object.
 */
export function getMessageText(message: { role?: string; content?: unknown }): string {
  return flattenMessageText(message.content);
}

/**
 * Check if a message has non-text content (images, audio, etc.).
 */
export function hasMultimodalContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(part => {
    if (typeof part !== 'object' || part === null) return false;
    const type = String((part as any).type || '').toLowerCase();
    return NON_TEXT_PART_TYPES.has(type);
  });
}

/**
 * Count approximate tokens in content (rough: 1 token ≈ 4 chars).
 */
export function estimateContentTokens(content: unknown): number {
  const text = flattenMessageText(content);
  return Math.ceil(text.length / 4);
}
