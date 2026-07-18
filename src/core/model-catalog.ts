/**
 * Model catalog — model metadata and capabilities.
 */

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutput: number;
  capabilities: string[];
  costPerMillionInput: number;
  costPerMillionOutput: number;
  description: string;
}

// Model catalog
const MODEL_CATALOG: ModelEntry[] = [
  {
    id: 'nemotron-3-ultra-550b-a55b',
    name: 'Nemotron 3 Ultra',
    provider: 'nvidia',
    contextWindow: 131072,
    maxOutput: 16384,
    capabilities: ['reasoning', 'code', 'tools', 'thinking'],
    costPerMillionInput: 0,
    costPerMillionOutput: 0,
    description: 'Best free reasoning model',
  },
  {
    id: 'deepseek-ai/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'nvidia',
    contextWindow: 131072,
    maxOutput: 16384,
    capabilities: ['reasoning', 'code', 'thinking'],
    costPerMillionInput: 0,
    costPerMillionOutput: 0,
    description: 'Strong reasoning model',
  },
  {
    id: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B',
    provider: 'groq',
    contextWindow: 131072,
    maxOutput: 32768,
    capabilities: ['code', 'tools', 'fast'],
    costPerMillionInput: 0,
    costPerMillionOutput: 0,
    description: 'Fast general-purpose model',
  },
];

/**
 * Get the model catalog.
 */
export function getModelCatalog(): ModelEntry[] {
  return [...MODEL_CATALOG];
}

/**
 * Get a model by ID.
 */
export function getModelById(id: string): ModelEntry | undefined {
  return MODEL_CATALOG.find(m => m.id === id);
}

/**
 * Search models by query.
 */
export function searchModels(query: string): ModelEntry[] {
  const lower = query.toLowerCase();
  return MODEL_CATALOG.filter(m =>
    m.name.toLowerCase().includes(lower) ||
    m.id.toLowerCase().includes(lower) ||
    m.description.toLowerCase().includes(lower) ||
    m.capabilities.some(c => c.includes(lower))
  );
}

/**
 * Get models by capability.
 */
export function getModelsByCapability(capability: string): ModelEntry[] {
  return MODEL_CATALOG.filter(m => m.capabilities.includes(capability));
}

/**
 * Format model catalog for display.
 */
export function formatModelCatalog(): string {
  return MODEL_CATALOG.map(m =>
    `• ${m.name} (${m.provider}): ${m.description} [${m.capabilities.join(', ')}]`
  ).join('\n');
}
