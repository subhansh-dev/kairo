/**
 * Thinking-timeout detection and user-facing guidance for reasoning models.
 *
 * When a reasoning model hits a transport-layer error before the first content
 * token arrives, the upstream proxy has likely idle-killed a long thinking stream.
 * This module provides detection and user-facing guidance.
 */

import { getReasoningStaleTimeoutFloor } from './reasoning-timeouts.js';

// Transport-kill substrings that indicate a stream disconnect
const THINKING_TIMEOUT_SUBSTRINGS = [
  'broken pipe',
  'errno 32',
  'remote protocol',
  'connection reset',
  'connection lost',
  'peer closed',
  'server disconnected',
  'socket hang up',
  'econnreset',
  'econnrefused',
];

/**
 * Check if an error indicates a reasoning model thinking timeout.
 * Returns true when ALL conditions hold:
 * 1. The error is a transport-layer failure (not HTTP error)
 * 2. The model is a known reasoning model
 * 3. The error message contains a transport-kill substring
 */
export function isThinkingTimeout(
  model: string,
  errorMsg: string,
  statusCode?: number | null,
): boolean {
  // Must be a transport error (no HTTP status)
  if (statusCode !== null && statusCode !== undefined) return false;

  // Must be a reasoning model
  if (getReasoningStaleTimeoutFloor(model) === null) return false;

  // Must contain a transport-kill substring
  const lower = errorMsg.toLowerCase();
  return THINKING_TIMEOUT_SUBSTRINGS.some(p => lower.includes(p));
}

/**
 * Build user-facing guidance for a thinking timeout.
 */
export function buildThinkingTimeoutGuidance(
  provider: string,
  model: string,
  modelLabel?: string,
): string {
  const label = modelLabel || model;
  return [
    '',
    `The model's thinking phase exceeded the upstream proxy's idle timeout before the first content token arrived.`,
    `This is a known issue with reasoning models (like ${label}) behind cloud gateways.`,
    '',
    'Workarounds (priority order):',
    `1. Increase the stale timeout in your config for ${provider}/${model}`,
    '2. Lower reasoning effort or use a smaller reasoning model',
    '3. Use a non-reasoning model for tasks that don\'t need deep thinking',
  ].join('\n');
}

/**
 * Check if an error is a stream drop (mid-stream disconnect).
 */
export function isStreamDrop(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const lower = error.message.toLowerCase();
  return THINKING_TIMEOUT_SUBSTRINGS.some(p => lower.includes(p));
}

/**
 * Build a user-visible message for a stream drop.
 */
export function buildStreamDropMessage(
  attempt: number,
  maxAttempts: number,
  provider: string,
  elapsed?: number,
): string {
  const elapsedStr = elapsed ? ` after ${(elapsed / 1000).toFixed(1)}s` : '';
  return `⚠️ ${provider} stream dropped${elapsedStr} — reconnecting, retry ${attempt}/${maxAttempts}`;
}
