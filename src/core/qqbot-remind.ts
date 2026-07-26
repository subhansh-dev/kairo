/**
 * QQ Bot remind — QQ Bot reminder integration.
 */

export interface QQBotReminder {
  id: string;
  content: string;
  time: number;
  channelId?: string;
  recurring?: boolean;
}

/**
 * Build a QQ Bot reminder.
 */
export function buildQQBotReminder(content: string, time: number, channelId?: string): QQBotReminder {
  return {
    id: `remind_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    content,
    time,
    channelId,
  };
}

/**
 * Format QQ Bot reminder for display.
 */
export function formatQQBotReminder(reminder: QQBotReminder): string {
  const time = new Date(reminder.time).toLocaleString();
  const recurring = reminder.recurring ? ' (recurring)' : '';
  return `⏰ ${reminder.content} — ${time}${recurring}`;
}
