/**
 * DingTalk — DingTalk integration utilities.
 */

export interface DingTalkConfig {
  appKey: string;
  appSecret: string;
  agentId?: string;
}

export interface DingTalkMessage {
  msgtype: 'text' | 'markdown' | 'actionCard';
  content: string;
  at?: { atMobiles?: string[]; isAtAll?: boolean };
}

/**
 * Build a DingTalk text message.
 */
export function buildDingTalkTextMessage(content: string, atAll = false): DingTalkMessage {
  return {
    msgtype: 'text',
    content,
    at: { isAtAll: atAll },
  };
}

/**
 * Build a DingTalk markdown message.
 */
export function buildDingTalkMarkdownMessage(title: string, content: string): DingTalkMessage {
  return {
    msgtype: 'markdown',
    content: `# ${title}\n\n${content}`,
  };
}

/**
 * Build a DingTalk action card message.
 */
export function buildDingTalkActionCard(title: string, content: string, buttons: Array<{ title: string; actionUrl: string }>): Record<string, unknown> {
  return {
    msgtype: 'actionCard',
    actionCard: {
      title,
      text: content,
      btns: buttons,
    },
  };
}

/**
 * Format DingTalk message for display.
 */
export function formatDingTalkMessage(msg: DingTalkMessage): string {
  return `[${msg.msgtype}] ${msg.content.slice(0, 100)}${msg.content.length > 100 ? '…' : ''}`;
}
