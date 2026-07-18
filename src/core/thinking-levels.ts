/**
 * Kairo — Thinking Levels
 * Granular control over model reasoning effort.
 * Maps to provider-specific thinking/reasoning parameters.
 */

export const ThinkingLevel = {
  /** Disable reasoning entirely */
  Off: 'off',
  /** Defer to higher-level selector */
  Inherit: 'inherit',
  /** Minimal reasoning — fast, cheap */
  Minimal: 'minimal',
  /** Low reasoning */
  Low: 'low',
  /** Medium reasoning — balanced */
  Medium: 'medium',
  /** High reasoning — thorough */
  High: 'high',
  /** Maximum reasoning — slow, expensive, best quality */
  XHigh: 'xhigh',
} as const;

export type ThinkingLevel = (typeof ThinkingLevel)[keyof typeof ThinkingLevel];
export type ResolvedThinkingLevel = Exclude<ThinkingLevel, 'inherit'>;

/**
 * Map thinking level to provider-specific reasoning parameter.
 * Returns undefined if the level should disable reasoning.
 */
export function resolveThinkingEffort(level: ThinkingLevel): string | undefined {
  switch (level) {
    case ThinkingLevel.Off: return undefined;
    case ThinkingLevel.Minimal: return 'low';
    case ThinkingLevel.Low: return 'low';
    case ThinkingLevel.Medium: return 'medium';
    case ThinkingLevel.High: return 'high';
    case ThinkingLevel.XHigh: return 'high';
    default: return undefined;
  }
}

/**
 * Classify the appropriate thinking level based on task complexity.
 * Simple tasks don't need reasoning; complex tasks benefit from it.
 */
export function classifyThinkingLevel(
  complexity: 'simple' | 'medium' | 'complex',
  isCoding: boolean,
  isPlanning: boolean,
): ResolvedThinkingLevel {
  if (complexity === 'simple') return ThinkingLevel.Off;
  if (complexity === 'medium') return isCoding ? ThinkingLevel.Low : ThinkingLevel.Off;
  // Complex
  if (isPlanning) return ThinkingLevel.High;
  if (isCoding) return ThinkingLevel.Medium;
  return ThinkingLevel.Low;
}
