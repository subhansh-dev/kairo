/**
 * Compaction configuration — thresholds, model overrides, and budget settings.
 */

type AgentType = string;

export interface CompactionConfig {
  /** Maximum tokens to keep after compaction */
  maxKeepTokens: number;
  /** Minimum tokens before compaction triggers */
  minCompactableTokens: number;
  /** Target ratio: compact when context exceeds this fraction of max */
  triggerRatio: number;
  /** Model override for compaction calls */
  modelOverride?: string;
  /** Temperature for compaction calls */
  temperature: number;
  /** Max tokens for the compaction summary */
  summaryMaxTokens: number;
  /** Enable intra-compaction (mid-conversation) */
  enableIntraCompaction: boolean;
  /** Enable inter-compaction (between conversations) */
  enableInterCompaction: boolean;
  /** Compaction strategy */
  strategy: 'rolling' | 'full' | 'hybrid';
}

export interface CompactionThresholds {
  /** Token count that triggers compaction */
  trigger: number;
  /** Maximum tokens to keep */
  keep: number;
  /** Minimum tokens to make compaction worthwhile */
  minCompactable: number;
}

export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  maxKeepTokens: 32000,
  minCompactableTokens: 4000,
  triggerRatio: 0.8,
  temperature: 0.0,
  summaryMaxTokens: 4096,
  enableIntraCompaction: true,
  enableInterCompaction: true,
  strategy: 'hybrid',
};

/**
 * Compute compaction thresholds for a given context window.
 */
export function computeThresholds(
  contextWindow: number,
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
): CompactionThresholds {
  const trigger = Math.floor(contextWindow * config.triggerRatio);
  const keep = Math.min(config.maxKeepTokens, Math.floor(contextWindow * 0.4));
  const minCompactable = config.minCompactableTokens;

  return { trigger, keep, minCompactable };
}

/**
 * Get the effective model for compaction calls.
 */
export function getCompactionModel(
  agentType: AgentType,
  config: CompactionConfig = DEFAULT_COMPACTION_CONFIG,
): string | undefined {
  return config.modelOverride;
}
