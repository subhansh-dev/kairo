/**
 * Model normalize — normalize model names and identifiers.
 */

/**
 * Normalize a model name to a consistent format.
 */
export function normalizeModelName(model: string): string {
  // Remove provider prefix if present
  const parts = model.split('/');
  if (parts.length >= 2) {
    // Keep as provider/model format
    return model.toLowerCase().trim();
  }
  return model.toLowerCase().trim();
}

/**
 * Parse a model string into provider and model components.
 */
export function parseModelString(model: string): { provider: string; model: string } {
  const parts = model.split('/');
  if (parts.length >= 2) {
    return { provider: parts[0].toLowerCase(), model: parts.slice(1).join('/').toLowerCase() };
  }
  return { provider: '', model: model.toLowerCase() };
}

/**
 * Format a model string from provider and model.
 */
export function formatModelString(provider: string, model: string): string {
  if (provider) return `${provider}/${model}`;
  return model;
}

/**
 * Check if two model strings refer to the same model.
 */
export function isSameModel(a: string, b: string): boolean {
  return normalizeModelName(a) === normalizeModelName(b);
}

/**
 * Get a display-friendly model name.
 */
export function getModelDisplayName(model: string): string {
  const { provider, model: modelName } = parseModelString(model);
  // Capitalize and clean up
  const displayName = modelName
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
  return provider ? `${displayName} (${provider})` : displayName;
}
