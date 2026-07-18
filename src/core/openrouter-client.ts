/**
 * OpenRouter client — OpenRouter API client utilities.
 */

export interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  contextLength: number;
  pricing: {
    prompt: number;
    completion: number;
  };
}

/**
 * Build an OpenRouter API request.
 */
export function buildOpenRouterRequest(model: string, messages: unknown[], opts: { temperature?: number; maxTokens?: number } = {}): Record<string, unknown> {
  return {
    model,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 4096,
  };
}

/**
 * Format OpenRouter model for display.
 */
export function formatOpenRouterModel(model: OpenRouterModel): string {
  const cost = model.pricing.prompt === 0 ? 'free' : `$${model.pricing.prompt}/M tokens`;
  return `${model.name} (${model.contextLength} ctx, ${cost})`;
}

/**
 * Check if a model is free on OpenRouter.
 */
export function isFreeModel(model: OpenRouterModel): boolean {
  return model.pricing.prompt === 0 && model.pricing.completion === 0;
}
