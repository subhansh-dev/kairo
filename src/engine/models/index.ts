/**
 * Model definitions — supported models, providers, and routing metadata.
 */

export type ModelProvider = 'nvidia' | 'groq' | 'cerebras' | 'openrouter' | 'ollama' | 'lmstudio' | 'mimo';

export interface ModelDef {
  id: string;
  name: string;
  provider: ModelProvider;
  contextWindow: number;
  maxOutput: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsImages: boolean;
  costPer1kInput?: number;
  costPer1kOutput?: number;
  tier: 'fast' | 'balanced' | 'power';
}

export const MODELS: ModelDef[] = [
  // NVIDIA
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    name: 'Nemotron 3 Ultra 550B',
    provider: 'nvidia',
    contextWindow: 131072,
    maxOutput: 16384,
    supportsTools: true,
    supportsStreaming: true,
    supportsImages: true,
    tier: 'power',
  },
  // Groq
  {
    id: 'groq/gpt-oss-120b',
    name: 'GPT-OSS 120B',
    provider: 'groq',
    contextWindow: 131072,
    maxOutput: 16384,
    supportsTools: true,
    supportsStreaming: true,
    supportsImages: false,
    tier: 'balanced',
  },
  {
    id: 'groq/gpt-oss-20b',
    name: 'GPT-OSS 20B',
    provider: 'groq',
    contextWindow: 131072,
    maxOutput: 16384,
    supportsTools: true,
    supportsStreaming: true,
    supportsImages: false,
    tier: 'fast',
  },
  // Cerebras
  {
    id: 'cerebras/gpt-oss-120b',
    name: 'Cerebras GPT-OSS 120B',
    provider: 'cerebras',
    contextWindow: 131072,
    maxOutput: 16384,
    supportsTools: true,
    supportsStreaming: true,
    supportsImages: false,
    tier: 'balanced',
  },
  {
    id: 'cerebras/gpt-oss-20b',
    name: 'Cerebras GPT-OSS 20B',
    provider: 'cerebras',
    contextWindow: 131072,
    maxOutput: 16384,
    supportsTools: true,
    supportsStreaming: true,
    supportsImages: false,
    tier: 'fast',
  },
];

/**
 * Look up a model by ID.
 */
export function getModel(id: string): ModelDef | undefined {
  return MODELS.find(m => m.id === id);
}

/**
 * Get all models for a provider.
 */
export function getModelsByProvider(provider: ModelProvider): ModelDef[] {
  return MODELS.filter(m => m.provider === provider);
}

/**
 * Get all models by tier.
 */
export function getModelsByTier(tier: ModelDef['tier']): ModelDef[] {
  return MODELS.filter(m => m.tier === tier);
}

/**
 * Get the default model (first power-tier model, or first model).
 */
export function getDefaultModel(): ModelDef {
  return MODELS.find(m => m.tier === 'power') ?? MODELS[0];
}

/**
 * List all provider IDs.
 */
export function listProviders(): ModelProvider[] {
  return [...new Set(MODELS.map(m => m.provider))];
}
