/**
 * Webhook — webhook management utilities.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  secret?: string;
  enabled: boolean;
  createdAt: number;
}

const WEBHOOKS_FILE = join(homedir(), '.kairo', 'webhooks.json');

/**
 * Load webhooks from disk.
 */
function loadWebhooks(): Webhook[] {
  try {
    if (existsSync(WEBHOOKS_FILE)) {
      return JSON.parse(readFileSync(WEBHOOKS_FILE, 'utf-8'));
    }
  } catch { /* ok */ }
  return [];
}

/**
 * Save webhooks to disk.
 */
function saveWebhooks(webhooks: Webhook[]): void {
  try {
    const dir = join(homedir(), '.kairo');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(WEBHOOKS_FILE, JSON.stringify(webhooks, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Register a webhook.
 */
export function registerWebhook(url: string, events: string[], secret?: string): Webhook {
  const webhooks = loadWebhooks();
  const webhook: Webhook = {
    id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    url,
    events,
    secret,
    enabled: true,
    createdAt: Date.now(),
  };
  webhooks.push(webhook);
  saveWebhooks(webhooks);
  return webhook;
}

/**
 * Get all webhooks.
 */
export function getWebhooks(): Webhook[] {
  return loadWebhooks();
}

/**
 * Remove a webhook.
 */
export function removeWebhook(id: string): boolean {
  const webhooks = loadWebhooks();
  const idx = webhooks.findIndex(w => w.id === id);
  if (idx === -1) return false;
  webhooks.splice(idx, 1);
  saveWebhooks(webhooks);
  return true;
}

/**
 * Enable/disable a webhook.
 */
export function toggleWebhook(id: string, enabled: boolean): boolean {
  const webhooks = loadWebhooks();
  const webhook = webhooks.find(w => w.id === id);
  if (!webhook) return false;
  webhook.enabled = enabled;
  saveWebhooks(webhooks);
  return true;
}

/**
 * Format webhooks for display.
 */
export function formatWebhooks(): string {
  const webhooks = getWebhooks();
  if (webhooks.length === 0) return 'No webhooks configured.';
  return webhooks.map(w => {
    const icon = w.enabled ? '✅' : '⏸️';
    return `${icon} ${w.url} [${w.events.join(', ')}]`;
  }).join('\n');
}
