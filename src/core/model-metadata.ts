/**
 * Kairo — Model Metadata
 * Model metadata, context lengths, and token estimation.
 * Ported from Hermes Agent's model_metadata.py
 */

// ─── Model Definitions ──────────────────────────────────────────

export interface ModelDef {
  id: string;
  provider: string;
  contextLength: number;
  maxOutput: number;
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  costPer1kInput: number;
  costPer1kOutput: number;
  speedTier: 'fast' | 'medium' | 'slow';
}

const MODELS: Record<string, ModelDef> = {
  'nvidia/nemotron-3-ultra-550b-a55b': {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    provider: 'nvidia',
    contextLength: 1000000,
    maxOutput: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.012,
    speedTier: 'slow',
  },
  'nvidia/nemotron-3-super-120b-a12b': {
    id: 'nvidia/nemotron-3-super-120b-a12b',
    provider: 'nvidia',
    contextLength: 1000000,
    maxOutput: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    costPer1kInput: 0.001,
    costPer1kOutput: 0.005,
    speedTier: 'fast',
  },
  'groq/openai/gpt-oss-120b': {
    id: 'groq/openai/gpt-oss-120b',
    provider: 'groq',
    contextLength: 128000,
    maxOutput: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    costPer1kInput: 0.0,
    costPer1kOutput: 0.0,
    speedTier: 'fast',
  },
  'groq/openai/gpt-oss-20b': {
    id: 'groq/openai/gpt-oss-20b',
    provider: 'groq',
    contextLength: 128000,
    maxOutput: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    costPer1kInput: 0.0,
    costPer1kOutput: 0.0,
    speedTier: 'fast',
  },
  'cerebras/gpt-oss-120b': {
    id: 'cerebras/gpt-oss-120b',
    provider: 'cerebras',
    contextLength: 128000,
    maxOutput: 4096,
    supportsVision: false,
    supportsTools: true,
    supportsStreaming: true,
    costPer1kInput: 0.0,
    costPer1kOutput: 0.0,
    speedTier: 'fast',
  },
};

// ─── Token Estimation ───────────────────────────────────────────

/**
 * Estimate token count from text.
 * Rule of thumb: 1 token ≈ 4 characters for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate tokens for a message array.
 */
export function estimateMessagesTokens(messages: Array<{ role: string; content: string }>): number {
  let total = 4; // base overhead
  for (const msg of messages) {
    total += estimateTokens(msg.content) + 4; // per-message overhead
  }
  return total;
}

/**
 * Estimate tokens for a request including tools.
 */
export function estimateRequestTokens(
  messages: Array<{ role: string; content: string }>,
  tools: Array<{ function: { name: string; description: string } }>,
): number {
  let total = estimateMessagesTokens(messages);
  // Tool definitions add tokens
  for (const tool of tools) {
    total += estimateTokens(tool.function.name) + estimateTokens(tool.function.description) + 10;
  }
  return total;
}

// ─── Context Length ──────────────────────────────────────────────

const MINIMUM_CONTEXT_LENGTH = 32000;

export function getContextLength(modelId: string): number {
  return MODELS[modelId]?.contextLength || 128000;
}

export function getMaxOutput(modelId: string): number {
  return MODELS[modelId]?.maxOutput || 4096;
}

export function getModelDef(modelId: string): ModelDef | undefined {
  return MODELS[modelId];
}

/**
 * Check if the request fits in the model's context window.
 */
export function fitsInContext(modelId: string, requestTokens: number): boolean {
  const ctx = getContextLength(modelId);
  const maxOut = getMaxOutput(modelId);
  return requestTokens + maxOut < ctx;
}

/**
 * Get the available output tokens given the input.
 */
export function getAvailableOutputTokens(modelId: string, inputTokens: number): number {
  const ctx = getContextLength(modelId);
  return Math.max(0, ctx - inputTokens - 1000); // 1000 token buffer
}

// ─── Cost Estimation ────────────────────────────────────────────

export function estimateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const def = MODELS[modelId];
  if (!def) return 0;
  return (inputTokens / 1000) * def.costPer1kInput + (outputTokens / 1000) * def.costPer1kOutput;
}

// ─── Model Capability Checks ────────────────────────────────────

export function supportsVision(modelId: string): boolean {
  return MODELS[modelId]?.supportsVision ?? false;
}

export function supportsTools(modelId: string): boolean {
  return MODELS[modelId]?.supportsTools ?? true;
}

export function getSpeedTier(modelId: string): string {
  return MODELS[modelId]?.speedTier ?? 'medium';
}
