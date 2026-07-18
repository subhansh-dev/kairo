/**
 * Image generation — image generation tool integration.
 */

export interface ImageGenOptions {
  prompt: string;
  width?: number;
  height?: number;
  model?: string;
  style?: string;
  negativePrompt?: string;
}

export interface ImageGenResult {
  url?: string;
  base64?: string;
  revisedPrompt?: string;
  error?: string;
}

/**
 * Build an image generation request.
 */
export function buildImageGenRequest(opts: ImageGenOptions): Record<string, unknown> {
  return {
    prompt: opts.prompt,
    width: opts.width || 1024,
    height: opts.height || 1024,
    model: opts.model || 'dall-e-3',
    style: opts.style || 'natural',
    ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
  };
}

/**
 * Format an image generation result for display.
 */
export function formatImageGenResult(result: ImageGenResult): string {
  if (result.error) return `Error: ${result.error}`;
  const parts = ['Image generated successfully.'];
  if (result.url) parts.push(`URL: ${result.url}`);
  if (result.revisedPrompt) parts.push(`Revised prompt: ${result.revisedPrompt}`);
  return parts.join('\n');
}

/**
 * Check if a model supports image generation.
 */
export function supportsImageGeneration(model: string): boolean {
  const supported = ['dall-e-3', 'dall-e-2', 'stable-diffusion', 'midjourney'];
  return supported.some(m => model.toLowerCase().includes(m));
}

/**
 * Validate image generation options.
 */
export function validateImageGenOptions(opts: ImageGenOptions): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!opts.prompt || opts.prompt.trim().length === 0) errors.push('Prompt is required');
  if (opts.prompt && opts.prompt.length > 4000) errors.push('Prompt too long (max 4000 chars)');
  if (opts.width && (opts.width < 256 || opts.width > 2048)) errors.push('Width must be 256-2048');
  if (opts.height && (opts.height < 256 || opts.height > 2048)) errors.push('Height must be 256-2048');
  return { valid: errors.length === 0, errors };
}
