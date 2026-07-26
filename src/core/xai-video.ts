/**
 * XAI video tools — xAI video generation integration.
 */

export interface XAIVideoRequest {
  prompt: string;
  duration?: number;
  resolution?: string;
  style?: string;
}

export interface XAIVideoResult {
  videoUrl?: string;
  thumbnailUrl?: string;
  duration?: number;
  error?: string;
}

/**
 * Build an xAI video request.
 */
export function buildXAIVideoRequest(prompt: string, opts: Partial<XAIVideoRequest> = {}): XAIVideoRequest {
  return {
    prompt,
    duration: opts.duration || 5,
    resolution: opts.resolution || '1080p',
    style: opts.style || 'realistic',
  };
}

/**
 * Format xAI video result for display.
 */
export function formatXAIVideoResult(result: XAIVideoResult): string {
  if (result.error) return `Error: ${result.error}`;
  const parts = ['Video generated successfully.'];
  if (result.videoUrl) parts.push(`URL: ${result.videoUrl}`);
  if (result.duration) parts.push(`Duration: ${result.duration}s`);
  return parts.join('\n');
}

/**
 * Validate video request options.
 */
export function validateVideoRequest(opts: XAIVideoRequest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!opts.prompt || opts.prompt.trim().length === 0) errors.push('Prompt is required');
  if (opts.duration && (opts.duration < 1 || opts.duration > 60)) errors.push('Duration must be 1-60 seconds');
  return { valid: errors.length === 0, errors };
}
