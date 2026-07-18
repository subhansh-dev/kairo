/**
 * Credits tracking for provider API responses.
 *
 * Parses credit headers from provider responses into structured state.
 * Provides depletion detection and usage fraction tracking.
 */

export interface CreditsState {
  version: number;
  remainingMicros: number;
  remainingUsd: string;
  subscriptionMicros: number;
  subscriptionUsd: string;
  subscriptionLimitMicros: number | null;
  subscriptionLimitUsd: string | null;
  rolloverMicros: number;
  purchasedMicros: number;
  purchasedUsd: string;
  denominatorKind: string;
  paidAccess: boolean;
  disabledReason: string | null;
  asOfMs: number;
  toolPoolMicros: number | null;
  toolPoolGatedOff: boolean;
}

/**
 * Safely parse a header value to an integer (money-safe).
 * Returns null if the value is not a valid integer string.
 */
function safeInt(value: string | undefined | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = parseInt(String(value), 10);
  if (isNaN(parsed)) return null;
  return parsed;
}

/**
 * Check if a header value is truthy.
 */
function isTruthy(value: string | undefined | null): boolean {
  if (!value) return false;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase().trim());
}

/**
 * Parse credit headers from a response into a CreditsState.
 */
export function parseCreditsHeaders(headers: Record<string, string>): CreditsState | null {
  const version = safeInt(headers['x-nous-credits-version']);
  if (version === null) return null;

  const remainingMicros = safeInt(headers['x-nous-credits-remaining-micros']) ?? 0;
  const subscriptionMicros = safeInt(headers['x-nous-credits-subscription-micros']) ?? 0;
  const subscriptionLimitMicros = safeInt(headers['x-nous-credits-subscription-limit-micros']);
  const rolloverMicros = safeInt(headers['x-nous-credits-rollover-micros']) ?? 0;
  const purchasedMicros = safeInt(headers['x-nous-credits-purchased-micros']) ?? 0;
  const asOfMs = safeInt(headers['x-nous-credits-as-of-ms']) ?? Date.now();
  const toolPoolMicros = safeInt(headers['x-nous-tool-pool-micros']);

  return {
    version,
    remainingMicros,
    remainingUsd: headers['x-nous-credits-remaining-usd'] || '',
    subscriptionMicros,
    subscriptionUsd: headers['x-nous-credits-subscription-usd'] || '',
    subscriptionLimitMicros,
    subscriptionLimitUsd: headers['x-nous-credits-subscription-limit-usd'] || null,
    rolloverMicros,
    purchasedMicros,
    purchasedUsd: headers['x-nous-credits-purchased-usd'] || '',
    denominatorKind: headers['x-nous-credits-denominator-kind'] || 'none',
    paidAccess: isTruthy(headers['x-nous-credits-paid-access']),
    disabledReason: headers['x-nous-credits-disabled-reason'] || null,
    asOfMs,
    toolPoolMicros,
    toolPoolGatedOff: isTruthy(headers['x-nous-tool-pool-gated-off']),
  };
}

/**
 * Check if credits are depleted (no paid access).
 */
export function isCreditsDepleted(state: CreditsState | null): boolean {
  if (!state) return false;
  return !state.paidAccess && state.remainingMicros <= 0;
}

/**
 * Get the subscription usage fraction (0-1).
 * Returns null if no subscription cap is set.
 */
export function getSubscriptionFraction(state: CreditsState | null): number | null {
  if (!state || !state.subscriptionLimitMicros || state.subscriptionLimitMicros <= 0) {
    return null;
  }
  const used = state.subscriptionLimitMicros - state.subscriptionMicros;
  return Math.max(0, Math.min(1, used / state.subscriptionLimitMicros));
}

/**
 * Format credits state for display.
 */
export function formatCredits(state: CreditsState | null): string {
  if (!state) return 'No credit info';
  if (isCreditsDepleted(state)) return '⚠️ Credits depleted';
  if (state.disabledReason) return `⚠️ ${state.disabledReason}`;

  const fraction = getSubscriptionFraction(state);
  const fractionStr = fraction !== null ? ` (${Math.round(fraction * 100)}% used)` : '';

  return `Credits: ${state.remainingUsd || '$0.00'} remaining${fractionStr}`;
}

/**
 * Parse credits from a fetch Response object.
 */
export function parseCreditsFromResponse(response: Response): CreditsState | null {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    if (key.toLowerCase().startsWith('x-nous-credits-') || key.toLowerCase().startsWith('x-nous-tool-pool-')) {
      headers[key.toLowerCase()] = value;
    }
  });
  return parseCreditsHeaders(headers);
}
