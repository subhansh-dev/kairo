/**
 * QQ Bot media — QQ Bot media integration.
 */

export interface QQBotMedia {
  type: 'image' | 'video' | 'file' | 'audio';
  url: string;
  filename?: string;
  size?: number;
}

/**
 * Build a QQ Bot media message.
 */
export function buildQQBotMediaMessage(media: QQBotMedia): Record<string, unknown> {
  return {
    msg_type: media.type === 'image' ? 1 : media.type === 'video' ? 2 : 3,
    media: {
      url: media.url,
      filename: media.filename,
    },
  };
}

/**
 * Format QQ Bot media for display.
 */
export function formatQQBotMedia(media: QQBotMedia): string {
  const typeIcon = { image: '🖼️', video: '🎬', file: '📁', audio: '🎵' };
  const size = media.size ? ` (${formatSize(media.size)})` : '';
  return `${typeIcon[media.type]} ${media.filename || media.url}${size}`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
