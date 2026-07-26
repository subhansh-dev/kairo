/**
 * Mixture-of-Agents (MoA) runtime helpers.
 *
 * Gathers reference-model context before each iteration.
 * Fan-out independent advisory calls, collect results, feed to aggregator.
 */

export interface MoAReference {
  model: string;
  provider: string;
  output: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  costUsd: number | null;
  temperature: number;
}

export interface MoAConfig {
  enabled: boolean;
  references: Array<{
    model: string;
    provider: string;
    temperature?: number;
  }>;
  maxWorkers: number;
}

export interface MoAResult {
  references: MoAReference[];
  aggregatedOutput: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number | null;
}

const MAX_REFERENCE_WORKERS = 8;

/**
 * Build the reference context from multiple model outputs.
 */
export function buildReferenceContext(references: MoAReference[]): string {
  if (references.length === 0) return '';

  const parts = references.map((ref, i) => {
    const preview = ref.output.length > 2000 ? ref.output.slice(0, 2000) + '…' : ref.output;
    return `[Reference ${i + 1} — ${ref.provider}/${ref.model}]\n${preview}`;
  });

  return parts.join('\n\n---\n\n');
}

/**
 * Build a MoA prompt that includes reference context.
 */
export function buildMoAPrompt(
  originalPrompt: string,
  references: MoAReference[],
): string {
  const refContext = buildReferenceContext(references);
  if (!refContext) return originalPrompt;

  return `You are the aggregator in a Mixture-of-Agents setup. Multiple models have already analyzed this task. Consider their perspectives but produce your own independent answer.

${refContext}

---

Original task: ${originalPrompt}

Produce your response considering the reference perspectives above, but make your own independent judgment.`;
}

/**
 * Calculate aggregate stats from references.
 */
export function aggregateMoAStats(references: MoAReference[]): {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number | null;
} {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCostUsd: number | null = null;

  for (const ref of references) {
    totalInputTokens += ref.usage.inputTokens;
    totalOutputTokens += ref.usage.outputTokens;
    if (ref.costUsd !== null) {
      totalCostUsd = (totalCostUsd || 0) + ref.costUsd;
    }
  }

  return { totalInputTokens, totalOutputTokens, totalCostUsd };
}

/**
 * Format MoA results for display.
 */
export function formatMoAResult(result: MoAResult): string {
  const lines = [
    `MoA: ${result.references.length} references`,
    `Tokens: ${result.totalInputTokens.toLocaleString()} in, ${result.totalOutputTokens.toLocaleString()} out`,
  ];
  if (result.totalCostUsd !== null) {
    lines.push(`Cost: $${result.totalCostUsd.toFixed(6)}`);
  }
  return lines.join(' | ');
}

/**
 * Check if MoA is enabled in the config.
 */
export function isMoAEnabled(config: MoAConfig | null | undefined): boolean {
  return Boolean(config?.enabled && config.references.length > 0);
}
