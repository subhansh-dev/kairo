/**
 * QQ Bot channel — QQ Bot channel integration.
 */

export interface QQBotChannel {
  id: string;
  name: string;
  type: 'group' | 'direct';
  enabled: boolean;
}

/**
 * Format QQ Bot channel for display.
 */
export function formatQQBotChannel(channel: QQBotChannel): string {
  const icon = channel.enabled ? '✅' : '⏸️';
  const typeIcon = channel.type === 'group' ? '👥' : '💬';
  return `${icon} ${typeIcon} ${channel.name} (${channel.id})`;
}

/**
 * Build a QQ Bot message.
 */
export function buildQQBotMessage(content: string, channelId?: string): Record<string, unknown> {
  return {
    content,
    channel_id: channelId,
  };
}
