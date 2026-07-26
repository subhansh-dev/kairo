/**
 * Provider catalog — provider metadata and capabilities.
 */

export interface ProviderEntry {
  id: string;
  name: string;
  baseUrl: string;
  envVars: string[];
  models: string[];
  capabilities: string[];
  free: boolean;
  description: string;
}

// Provider catalog
const PROVIDER_CATALOG: ProviderEntry[] = [
  {
    id: 'nvidia',
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    envVars: ['NVIDIA_API_KEY'],
    models: ['nemotron-3-ultra-550b-a55b', 'deepseek-ai/deepseek-r1', 'meta/llama-3.3-70b-instruct'],
    capabilities: ['reasoning', 'code', 'tools', 'thinking'],
    free: true,
    description: 'Free tier with best reasoning models',
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    envVars: ['GROQ_API_KEY'],
    models: ['llama-3.3-70b-versatile', 'gemma2-9b-it'],
    capabilities: ['fast', 'code', 'tools'],
    free: true,
    description: 'Ultra-fast inference',
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    baseUrl: 'https://api.cerebras.ai/v1',
    envVars: ['CEREBRAS_API_KEY'],
    models: ['llama-3.3-70b'],
    capabilities: ['fast', 'code'],
    free: true,
    description: 'Fast inference on custom hardware',
  },
];

/**
 * Get the provider catalog.
 */
export function getProviderCatalog(): ProviderEntry[] {
  return [...PROVIDER_CATALOG];
}

/**
 * Get a provider by ID.
 */
export function getProviderById(id: string): ProviderEntry | undefined {
  return PROVIDER_CATALOG.find(p => p.id === id);
}

/**
 * Get providers that support a capability.
 */
export function getProvidersByCapability(capability: string): ProviderEntry[] {
  return PROVIDER_CATALOG.filter(p => p.capabilities.includes(capability));
}

/**
 * Get free providers.
 */
export function getFreeProviders(): ProviderEntry[] {
  return PROVIDER_CATALOG.filter(p => p.free);
}

/**
 * Format provider catalog for display.
 */
export function formatProviderCatalog(): string {
  return PROVIDER_CATALOG.map(p =>
    `• ${p.name} (${p.id}): ${p.description} [${p.capabilities.join(', ')}]`
  ).join('\n');
}
