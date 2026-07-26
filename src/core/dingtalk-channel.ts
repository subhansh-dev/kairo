/**
 * DingTalk channel — DingTalk channel integration.
 */

export interface DingTalkChannelRule {
  pattern: string;
  response: string;
  enabled: boolean;
}

/**
 * Check if a message matches a channel rule.
 */
export function matchChannelRule(message: string, rules: DingTalkChannelRule[]): DingTalkChannelRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (message.includes(rule.pattern) || new RegExp(rule.pattern).test(message)) {
      return rule;
    }
  }
  return null;
}

/**
 * Format channel rules for display.
 */
export function formatChannelRules(rules: DingTalkChannelRule[]): string {
  if (rules.length === 0) return 'No channel rules configured.';
  return rules.map(r => {
    const icon = r.enabled ? '✅' : '⏸️';
    return `${icon} ${r.pattern} → ${r.response.slice(0, 50)}`;
  }).join('\n');
}
