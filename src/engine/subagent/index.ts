/**
 * Subagent resolution — resolves agent configurations for sub-agents.
 */

export type SubagentType = 'explore' | 'general' | 'code' | 'research' | 'custom';

export interface SubagentConfig {
  type: SubagentType;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  allowedTools?: string[];
  timeout?: number;
}

export interface SubagentOverride {
  type: SubagentType;
  overrides: Partial<SubagentConfig>;
}

const DEFAULT_CONFIGS: Record<SubagentType, SubagentConfig> = {
  explore: {
    type: 'explore',
    maxTokens: 16384,
    temperature: 0.0,
    allowedTools: ['read', 'grep', 'glob', 'list'],
    timeout: 60_000,
  },
  general: {
    type: 'general',
    maxTokens: 16384,
    temperature: 0.3,
    timeout: 120_000,
  },
  code: {
    type: 'code',
    maxTokens: 16384,
    temperature: 0.0,
    timeout: 180_000,
  },
  research: {
    type: 'research',
    maxTokens: 16384,
    temperature: 0.2,
    timeout: 300_000,
  },
  custom: {
    type: 'custom',
    maxTokens: 8192,
    temperature: 0.3,
    timeout: 120_000,
  },
};

/**
 * Resolve the config for a subagent type.
 */
export function resolveSubagentConfig(
  type: SubagentType,
  overrides?: SubagentOverride[],
): SubagentConfig {
  const base = { ...DEFAULT_CONFIGS[type] };

  if (overrides) {
    for (const o of overrides) {
      if (o.type === type) {
        Object.assign(base, o.overrides);
      }
    }
  }

  return base;
}

/**
 * Get all available subagent types.
 */
export function getSubagentTypes(): SubagentType[] {
  return Object.keys(DEFAULT_CONFIGS) as SubagentType[];
}
