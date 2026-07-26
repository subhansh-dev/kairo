/**
 * Kairo — Title Generator
 * Generate session titles from the first user message.
 * Ported from Hermes Agent's title_generator.py
 */

/**
 * Generate a short title from a user message.
 */
export function generateTitle(message: string): string {
  // Clean up
  let title = message.trim();

  // Remove common prefixes
  title = title.replace(/^(please|can you|could you|hey|hi|hello)\s*[,:-]?\s*/i, '');

  // Truncate at sentence boundary
  const sentenceEnd = title.search(/[.!?]\s/);
  if (sentenceEnd > 10 && sentenceEnd < 80) {
    title = title.slice(0, sentenceEnd + 1);
  }

  // Truncate at word boundary if too long
  if (title.length > 60) {
    const words = title.split(/\s+/);
    title = '';
    for (const word of words) {
      if ((title + ' ' + word).length > 55) break;
      title = title ? title + ' ' + word : word;
    }
    title += '…';
  }

  // Capitalize first letter
  if (title.length > 0) {
    title = title[0].toUpperCase() + title.slice(1);
  }

  return title || 'New Session';
}

/**
 * Generate an auto-title from a conversation.
 */
export function autoTitle(messages: Array<{ role: string; content: string }>): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser) return 'New Session';
  return generateTitle(firstUser.content);
}
