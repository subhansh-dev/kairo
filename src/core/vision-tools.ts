/**
 * Vision tools — image analysis capabilities.
 */

export interface VisionAnalysisResult {
  description: string;
  objects?: string[];
  text?: string;
  confidence?: number;
}

/**
 * Build a vision prompt for image analysis.
 */
export function buildVisionPrompt(imageDescription?: string, question?: string): string {
  const parts = ['Analyze this image.'];

  if (imageDescription) {
    parts.push(`Context: ${imageDescription}`);
  }

  if (question) {
    parts.push(`Specific question: ${question}`);
  } else {
    parts.push('Describe what you see in detail, including any text, objects, people, colors, and spatial relationships.');
  }

  return parts.join('\n');
}

/**
 * Format vision results for display.
 */
export function formatVisionResult(result: VisionAnalysisResult): string {
  const parts = [result.description];

  if (result.objects && result.objects.length > 0) {
    parts.push(`\nObjects: ${result.objects.join(', ')}`);
  }

  if (result.text) {
    parts.push(`\nText found: ${result.text}`);
  }

  if (result.confidence !== undefined) {
    parts.push(`\nConfidence: ${Math.round(result.confidence * 100)}%`);
  }

  return parts.join('');
}

/**
 * Check if a model supports vision.
 */
export function modelSupportsVision(model: string): boolean {
  const visionModels = [
    'gpt-4o', 'gpt-4-turbo', 'gpt-4-vision',
    'claude-3', 'claude-3.5', 'claude-4',
    'gemini-pro-vision', 'gemini-2',
    'llava', 'cogvlm', 'qwen-vl',
  ];
  const lower = model.toLowerCase();
  return visionModels.some(v => lower.includes(v));
}
