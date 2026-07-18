/**
 * Providers — provider management utilities.
 */

export interface ProviderStatus {
  id: string;
  name: string;
  available: boolean;
  models: string[];
  error?: string;
}

/**
 * Check provider availability.
 */
export function checkProviderStatus(id: string, apiKey?: string): ProviderStatus {
  const hasKey = !!apiKey || !!process.env[`${id.toUpperCase()}_API_KEY`];
  return {
    id,
    name: id,
    available: hasKey,
    models: [],
    error: hasKey ? undefined : 'No API key configured',
  };
}

/**
 * Format provider status for display.
 */
export function formatProviderStatus(status: ProviderStatus): string {
  const icon = status.available ? '✅' : '❌';
  const error = status.error ? ` — ${status.error}` : '';
  const models = status.models.length > 0 ? ` (${status.models.slice(0, 3).join(', ')})` : '';
  return `${icon} ${status.name}${models}${error}`;
}

/**
 * Get all configured providers.
 */
export function getConfiguredProviders(): string[] {
  const providers = ['nvidia', 'groq', 'cerebras'];
  return providers.filter(p => !!process.env[`${p.toUpperCase()}_API_KEY`]);
}
