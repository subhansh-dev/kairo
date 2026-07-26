/**
 * Send message — message sending utilities.
 */

export interface SendMessageOptions {
  to: string;
  message: string;
  channel?: string;
  platform?: string;
}

export interface SendMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Build a message send request.
 */
export function buildSendRequest(opts: SendMessageOptions): Record<string, unknown> {
  return {
    to: opts.to,
    message: opts.message,
    channel: opts.channel,
    platform: opts.platform,
  };
}

/**
 * Format a sent message for display.
 */
export function formatSentMessage(opts: SendMessageOptions): string {
  return `Sent to ${opts.to}: ${opts.message.slice(0, 100)}${opts.message.length > 100 ? '…' : ''}`;
}

/**
 * Validate send message options.
 */
export function validateSendOptions(opts: SendMessageOptions): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!opts.to) errors.push('Recipient is required');
  if (!opts.message) errors.push('Message is required');
  if (opts.message && opts.message.length > 4000) errors.push('Message too long (max 4000 chars)');
  return { valid: errors.length === 0, errors };
}
