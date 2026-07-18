/**
 * Per-reasoning-model stale-timeout floor for known reasoning models.
 *
 * Reasoning models (those that emit extended thinking blocks) routinely exceed
 * default stale timeouts. This module provides a floor so the stale detector
 * doesn't kill connections mid-think.
 */

// (slug, floor_seconds) — matched as start-of-model-slug
const REASONING_STALE_TIMEOUT_FLOORS: [string, number][] = [
  // NVIDIA Nemotron reasoning models
  ['nemotron-3-ultra', 600],
  ['nemotron-3-super', 600],
  ['nemotron-3-nano', 300],

  // DeepSeek reasoning models
  ['deepseek-r1', 600],
  ['deepseek-reasoner', 600],
  ['deepseek-v4-flash', 600],
  ['deepseek-v4-pro', 600],

  // Qwen reasoning models
  ['qwq-32b', 300],
  ['qwen3', 180],

  // OpenAI o-series
  ['o1', 600],
  ['o1-mini', 600],
  ['o1-pro', 600],
  ['o1-preview', 600],
  ['o3', 600],
  ['o3-pro', 600],
  ['o3-mini', 300],
  ['o4-mini', 300],

  // Anthropic thinking models
  ['claude-3-5-sonnet', 300],
  ['claude-3-opus', 300],
  ['claude-4', 300],

  // xAI Grok reasoning
  ['grok-3', 300],
  ['grok-3-mini', 300],

  // Google Gemini thinking
  ['gemini-2.5-pro', 300],
  ['gemini-2.5-flash', 180],
];

/**
 * Strip provider prefix from model name (e.g., "nvidia/nemotron-3-ultra" → "nemotron-3-ultra").
 */
function stripProviderPrefix(model: string): string {
  const slashIdx = model.indexOf('/');
  return slashIdx >= 0 ? model.slice(slashIdx + 1) : model;
}

/**
 * Get the reasoning-model stale-timeout floor for a model.
 * Returns the floor in seconds, or null if the model isn't a known reasoning model.
 */
export function getReasoningStaleTimeoutFloor(model: string): number | null {
  if (!model) return null;
  const slug = stripProviderPrefix(model).toLowerCase();

  for (const [pattern, floor] of REASONING_STALE_TIMEOUT_FLOORS) {
    // Start-of-slug match: pattern must be at position 0 or after a separator
    const idx = slug.indexOf(pattern);
    if (idx === -1) continue;
    // Check it's at a word boundary (start of string or after -/_/.)
    if (idx > 0) {
      const prevChar = slug[idx - 1];
      if (prevChar !== '-' && prevChar !== '_' && prevChar !== '.') continue;
    }
    return floor;
  }
  return null;
}

/**
 * Apply the reasoning timeout floor to a base timeout.
 * Returns max(base, floor) when the model is a reasoning model, otherwise base.
 */
export function applyReasoningTimeoutFloor(model: string, baseTimeoutSeconds: number): number {
  const floor = getReasoningStaleTimeoutFloor(model);
  if (floor === null) return baseTimeoutSeconds;
  return Math.max(baseTimeoutSeconds, floor);
}
