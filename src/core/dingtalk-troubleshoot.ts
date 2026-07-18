/**
 * DingTalk troubleshoot — DingTalk troubleshooting utilities.
 */

export interface DingTalkDiagnostic {
  check: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  fix?: string;
}

/**
 * Run DingTalk diagnostics.
 */
export function runDingTalkDiagnostics(config?: { appKey?: string; webhook?: string }): DingTalkDiagnostic[] {
  const checks: DingTalkDiagnostic[] = [];

  // Check app key
  checks.push({
    check: 'App Key',
    status: config?.appKey ? 'ok' : 'error',
    message: config?.appKey ? 'Configured' : 'Not configured',
    fix: !config?.appKey ? 'Set DINGTALK_APP_KEY environment variable' : undefined,
  });

  // Check webhook
  checks.push({
    check: 'Webhook',
    status: config?.webhook ? 'ok' : 'warning',
    message: config?.webhook ? 'Configured' : 'Not configured',
    fix: !config?.webhook ? 'Configure a DingTalk webhook for message delivery' : undefined,
  });

  return checks;
}

/**
 * Format DingTalk diagnostics for display.
 */
export function formatDingTalkDiagnostics(checks: DingTalkDiagnostic[]): string {
  const icon = { ok: '✅', warning: '⚠️', error: '❌' };
  return checks.map(c => {
    let line = `${icon[c.status]} ${c.check}: ${c.message}`;
    if (c.fix) line += `\n   Fix: ${c.fix}`;
    return line;
  }).join('\n');
}
