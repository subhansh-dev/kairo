/**
 * Models.dev registry integration — model metadata database.
 *
 * Fetches from https://models.dev — a community-maintained database of models.
 * Provides model metadata: context window, capabilities, cost, etc.
 */

const MODELS_DEV_URL = 'https://models.dev/api.json';
const CACHE_TTL = 3600_000; // 1 hour

export interface ModelInfo {
  id: string;
  name: string;
  family: string;
  providerId: string;

  // Capabilities
  reasoning: boolean;
  toolCall: boolean;
  vision: boolean;
  audio: boolean;
  pdf: boolean;
  structuredOutput: boolean;
  openWeights: boolean;

  // Limits
  contextWindow: number;
  maxOutput: number;

  // Cost (per million tokens, USD)
  costInput: number;
  costOutput: number;
  costCacheRead?: number;

  // Metadata
  knowledgeCutoff: string;
  releaseDate: string;
  status: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  envVars: string[];
  docsUrl: string;
}

// In-memory cache
let cache: Record<string, any> | null = null as Record<string, any> | null;
let cacheTime = 0;

/**
 * Fetch the models.dev registry.
 */
export async function fetchModelsDev(forceRefresh = false): Promise<Record<string, any>> {
  if (cache && !forceRefresh && Date.now() - cacheTime < CACHE_TTL) {
    return cache;
  }

  try {
    const response = await fetch(MODELS_DEV_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    cache = (await response.json()) as Record<string, any>;
    cacheTime = Date.now();
    return cache || {};
  } catch {
    return cache || {};
  }
}

/**
 * Get info for a specific model.
 */
export async function getModelInfo(modelId: string): Promise<ModelInfo | null> {
  const data = await fetchModelsDev();
  const model = data[modelId];
  if (!model) return null;

  return {
    id: model.id || modelId,
    name: model.name || modelId,
    family: model.family || '',
    providerId: model.provider_id || model.provider || '',
    reasoning: Boolean(model.reasoning),
    toolCall: Boolean(model.tool_call),
    vision: Boolean(model.attachment) || (model.input_modalities || []).includes('image'),
    audio: (model.input_modalities || []).includes('audio'),
    pdf: (model.input_modalities || []).includes('pdf'),
    structuredOutput: Boolean(model.structured_output),
    openWeights: Boolean(model.open_weights),
    contextWindow: model.context_window || 0,
    maxOutput: model.max_output || 0,
    costInput: model.cost_input || model.cost?.input || 0,
    costOutput: model.cost_output || model.cost?.output || 0,
    costCacheRead: model.cost_cache_read || model.cost?.cache_read,
    knowledgeCutoff: model.knowledge_cutoff || '',
    releaseDate: model.release_date || '',
    status: model.status || '',
  };
}

/**
 * Get all models for a provider.
 */
export async function getProviderModels(providerId: string): Promise<ModelInfo[]> {
  const data = await fetchModelsDev();
  const models: ModelInfo[] = [];

  for (const [id, model] of Object.entries(data)) {
    if ((model as any).provider_id === providerId || (model as any).provider === providerId) {
      const info = await getModelInfo(id);
      if (info) models.push(info);
    }
  }

  return models;
}

/**
 * Format model capabilities for display.
 */
export function formatCapabilities(model: ModelInfo): string {
  const caps: string[] = [];
  if (model.reasoning) caps.push('reasoning');
  if (model.toolCall) caps.push('tools');
  if (model.vision) caps.push('vision');
  if (model.pdf) caps.push('PDF');
  if (model.audio) caps.push('audio');
  if (model.structuredOutput) caps.push('structured');
  if (model.openWeights) caps.push('open-weights');
  return caps.join(', ') || 'basic';
}

/**
 * Format model cost for display.
 */
export function formatCost(model: ModelInfo): string {
  if (model.costInput === 0 && model.costOutput === 0) return 'free';
  const parts = [];
  if (model.costInput > 0) parts.push(`$${model.costInput.toFixed(2)}/M in`);
  if (model.costOutput > 0) parts.push(`$${model.costOutput.toFixed(2)}/M out`);
  return parts.join(', ') || 'unknown';
}

/**
 * Format context window for display.
 */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(0)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(0)}k`;
  return String(tokens);
}
