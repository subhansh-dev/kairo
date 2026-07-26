/**
 * Billing view — surface-agnostic billing state parsing.
 *
 * Parses billing data into structured types. Fail-open: returns empty state
 * when not logged in or unreachable.
 */

export interface CardInfo {
  brand: string;
  last4: string;
}

export interface MonthlyCap {
  limitUsd: number | null;
  spentThisMonthUsd: number | null;
  isDefaultCeiling: boolean;
}

export interface AutoReload {
  enabled: boolean;
  thresholdUsd: number | null;
  reloadToUsd: number | null;
}

export interface BillingState {
  loggedIn: boolean;
  orgId?: string;
  orgName?: string;
  planName?: string;
  card?: CardInfo;
  balanceUsd: number | null;
  monthlyCap?: MonthlyCap;
  autoReload?: AutoReload;
  subscriptionStatus?: string;
  trialEndsAt?: string;
}

/**
 * Parse a money value from server (decimal string) to number.
 * Returns null for missing/invalid input.
 */
export function parseMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(String(value).trim());
  if (isNaN(num)) return null;
  return num;
}

/**
 * Format a money value for display.
 */
export function formatMoney(value: number | null): string {
  if (value === null || value === undefined) return '—';
  if (Number.isInteger(value)) return `$${value}`;
  return `$${value.toFixed(2)}`;
}

/**
 * Parse billing state from a server response.
 */
export function parseBillingState(data: Record<string, unknown>): BillingState {
  if (!data || typeof data !== 'object') {
    return { loggedIn: false, balanceUsd: null };
  }

  const loggedIn = Boolean(data.logged_in || data.loggedIn);

  return {
    loggedIn,
    orgId: String(data.org_id || data.orgId || ''),
    orgName: String(data.org_name || data.orgName || ''),
    planName: String(data.plan_name || data.planName || ''),
    card: data.card ? {
      brand: String((data.card as any).brand || ''),
      last4: String((data.card as any).last4 || ''),
    } : undefined,
    balanceUsd: parseMoney(data.balance_usd || data.balanceUsd),
    monthlyCap: data.monthly_cap || data.monthlyCap ? {
      limitUsd: parseMoney((data.monthly_cap || data.monthlyCap as any)?.limit_usd || (data.monthly_cap || data.monthlyCap as any)?.limitUsd),
      spentThisMonthUsd: parseMoney((data.monthly_cap || data.monthlyCap as any)?.spent_this_month_usd || (data.monthly_cap || data.monthlyCap as any)?.spentThisMonthUsd),
      isDefaultCeiling: Boolean((data.monthly_cap || data.monthlyCap as any)?.is_default_ceiling || (data.monthly_cap || data.monthlyCap as any)?.isDefaultCeiling),
    } : undefined,
    autoReload: data.auto_reload || data.autoReload ? {
      enabled: Boolean((data.auto_reload || data.autoReload as any)?.enabled),
      thresholdUsd: parseMoney((data.auto_reload || data.autoReload as any)?.threshold_usd || (data.auto_reload || data.autoReload as any)?.thresholdUsd),
      reloadToUsd: parseMoney((data.auto_reload || data.autoReload as any)?.reload_to_usd || (data.auto_reload || data.autoReload as any)?.reloadToUsd),
    } : undefined,
    subscriptionStatus: String(data.subscription_status || data.subscriptionStatus || ''),
    trialEndsAt: String(data.trial_ends_at || data.trialEndsAt || ''),
  };
}

/**
 * Format billing state for display.
 */
export function formatBillingState(state: BillingState): string {
  if (!state.loggedIn) return 'Not logged in';

  const parts = [];
  if (state.planName) parts.push(`Plan: ${state.planName}`);
  if (state.balanceUsd !== null) parts.push(`Balance: ${formatMoney(state.balanceUsd)}`);
  if (state.card) parts.push(`Card: ${state.card.brand} ····${state.card.last4}`);
  if (state.monthlyCap?.spentThisMonthUsd !== null) {
    parts.push(`This month: ${formatMoney(state.monthlyCap?.spentThisMonthUsd ?? null)}`);
  }

  return parts.join(' | ') || 'Billing info available';
}
