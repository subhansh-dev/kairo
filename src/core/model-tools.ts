/**
 * Model tools — model-related tool utilities.
 */

export interface ModelToolConfig {
  model: string;
  provider: string;
  tools: string[];
  maxToolCalls: number;
}

/**
 * Build a model tools configuration.
 */
export function buildModelToolConfig(model: string, provider: string, tools: string[] = [], maxToolCalls = 20): ModelToolConfig {
  return { model, provider, tools, maxToolCalls };
}

/**
 * Check if a tool is available for a model.
 */
export function isToolAvailable(config: ModelToolConfig, toolName: string): boolean {
  return config.tools.length === 0 || config.tools.includes(toolName);
}

/**
 * Format model tools config for display.
 */
export function formatModelToolConfig(config: ModelToolConfig): string {
  return `${config.provider}/${config.model}: ${config.tools.length > 0 ? config.tools.join(', ') : 'all tools'} (max ${config.maxToolCalls})`;
}
