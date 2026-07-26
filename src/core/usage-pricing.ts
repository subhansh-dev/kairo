/**
 * Usage pricing — cost estimation for provider API calls.
 *
 * Tracks token usage and estimates costs for different providers.
 */

export interface CanonicalUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  requestCount: number;
}

export interface PricingEntry {
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  cacheReadCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
  requestCost?: number;
  source: string;
}

export interface CostResult {
  amountUsd: number | null;
  status: 'actual' | 'estimated' | 'included' | 'unknown';
  source: string;
  label: string;
}

// Default pricing (free models)
const DEFAULT_PRICING: PricingEntry = {
  inputCostPerMillion: 0,
  outputCostPerMillion: 0,
  source: 'default',
};

// Known provider pricing (per million tokens, in USD)
const PROVIDER_PRICING: Record<string, Record<string, PricingEntry>> = {
  nvidia: {
    'nemotron-3-ultra-550b-a55b': { inputCostPerMillion: 0, outputCostPerMillion: 0, source: 'free_tier' },
    'deepseek-ai/deepseek-r1': { inputCostPerMillion: 0, outputCostPerMillion: 0, source: 'free_tier' },
    'meta/llama-3.3-70b-instruct': { inputCostPerMillion: 0, outputCostPerMillion: 0, source: 'free_tier' },
  },
  groq: {
    'llama-3.3-70b-versatile': { inputCostPerMillion: 0, outputCostPerMillion: 0, source: 'free_tier' },
    'gemma2-9b-it': { inputCostPerMillion: 0, outputCostPerMillion: 0, source: 'free_tier' },
  },
  cerebras: {
    'llama-3.3-70b': { inputCostPerMillion: 0, outputCostPerMillion: 0, source: 'free_tier' },
  },
};

/**
 * Sum two usage buckets.
 */
export function addUsage(a: CanonicalUsage, b: CanonicalUsage): CanonicalUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    requestCount: a.requestCount + b.requestCount,
  };
}

/**
 * Get the total tokens from a usage bucket.
 */
export function getTotalTokens(usage: CanonicalUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

/**
 * Get pricing for a provider/model combination.
 */
export function getPricing(provider: string, model: string): PricingEntry {
  const providerPricing = PROVIDER_PRICING[provider];
  if (!providerPricing) return DEFAULT_PRICING;
  return providerPricing[model] || DEFAULT_PRICING;
}

/**
 * Estimate the cost of a usage bucket.
 */
export function estimateCost(
  usage: CanonicalUsage,
  provider: string,
  model: string,
): CostResult {
  const pricing = getPricing(provider, model);

  if (!pricing.inputCostPerMillion && !pricing.outputCostPerMillion) {
    return {
      amountUsd: 0,
      status: 'included',
      source: pricing.source,
      label: `${provider}/${model} (free tier)`,
    };
  }

  const inputCost = (usage.inputTokens / 1_000_000) * (pricing.inputCostPerMillion || 0);
  const outputCost = (usage.outputTokens / 1_000_000) * (pricing.outputCostPerMillion || 0);
  const cacheReadCost = (usage.cacheReadTokens / 1_000_000) * (pricing.cacheReadCostPerMillion || 0);
  const requestCost = pricing.requestCost || 0;

  const totalCost = inputCost + outputCost + cacheReadCost + requestCost;

  return {
    amountUsd: Math.round(totalCost * 1_000_000) / 1_000_000, // round to 6 decimal places
    status: 'estimated',
    source: pricing.source,
    label: `${provider}/${model}`,
  };
}

/**
 * Format a cost result for display.
 */
export function formatCost(result: CostResult): string {
  if (result.status === 'included' || result.amountUsd === 0) {
    return `${result.label}: Free`;
  }
  if (result.status === 'unknown' || result.amountUsd === null) {
    return `${result.label}: Cost unknown`;
  }
  return `${result.label}: $${result.amountUsd.toFixed(6)}`;
}

/**
 * Format usage for display.
 */
export function formatUsage(usage: CanonicalUsage): string {
  const parts = [];
  if (usage.inputTokens > 0) parts.push(`${usage.inputTokens.toLocaleString()} in`);
  if (usage.outputTokens > 0) parts.push(`${usage.outputTokens.toLocaleString()} out`);
  if (usage.cacheReadTokens > 0) parts.push(`${usage.cacheReadTokens.toLocaleString()} cache`);
  if (usage.reasoningTokens > 0) parts.push(`${usage.reasoningTokens.toLocaleString()} reason`);
  return parts.join(' | ') || 'No usage';
}
