/**
 * OpenRouter client — OpenRouter API integration.
 */

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
  top_provider: {
    max_completion_tokens: number;
  };
}

/**
 * Build an OpenRouter API request.
 */
export function buildOpenRouterRequest(opts: {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
}): Record<string, unknown> {
  return {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
  };
}

/**
 * Format an OpenRouter model for display.
 */
export function formatOpenRouterModel(model: OpenRouterModel): string {
  const cost = model.pricing.prompt === '0' ? 'free' : `$${model.pricing.prompt}/tok`;
  return `${model.name} (${model.context_length} ctx, ${cost})`;
}

/**
 * Check if a model is free.
 */
export function isFreeModel(model: OpenRouterModel): boolean {
  return model.pricing.prompt === '0' && model.pricing.completion === '0';
}

/**
 * Get model context window.
 */
export function getModelContextWindow(model: OpenRouterModel): number {
  return model.context_length || 128000;
}
