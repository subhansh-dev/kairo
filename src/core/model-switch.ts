/**
 * Model switch — model switching utilities.
 */

import { getConfigValue, setConfigValue } from './config.js';

export interface ModelSwitchResult {
  success: boolean;
  previousModel?: string;
  newModel: string;
  provider: string;
  message: string;
}

/**
 * Switch to a different model.
 */
export function switchModel(model: string, provider?: string): ModelSwitchResult {
  const previousModel = getConfigValue('model') as string | undefined;

  // Parse provider/model format
  let parsedProvider = provider || 'nvidia';
  let parsedModel = model;

  if (model.includes('/')) {
    const parts = model.split('/');
    parsedProvider = parts[0];
    parsedModel = parts.slice(1).join('/');
  }

  setConfigValue('model', parsedModel);
  if (provider) setConfigValue('provider', parsedProvider);

  return {
    success: true,
    previousModel,
    newModel: parsedModel,
    provider: parsedProvider,
    message: `Switched to ${parsedProvider}/${parsedModel}`,
  };
}

/**
 * Get the current model.
 */
export function getCurrentModel(): { model: string; provider: string } {
  return {
    model: String(getConfigValue('model') || 'default'),
    provider: String(getConfigValue('provider') || 'nvidia'),
  };
}

/**
 * Format model switch result for display.
 */
export function formatModelSwitch(result: ModelSwitchResult): string {
  const prev = result.previousModel ? ` (was ${result.previousModel})` : '';
  return `✅ ${result.message}${prev}`;
}

/**
 * Get popular model presets.
 */
export function getModelPresets(): Array<{ name: string; model: string; provider: string; description: string }> {
  return [
    { name: 'fast', model: 'llama-3.3-70b-versatile', provider: 'groq', description: 'Fast inference' },
    { name: 'smart', model: 'nemotron-3-ultra-550b-a55b', provider: 'nvidia', description: 'Best reasoning' },
    { name: 'balanced', model: 'deepseek-ai/deepseek-r1', provider: 'nvidia', description: 'Good balance' },
    { name: 'code', model: 'nemotron-3-ultra-550b-a55b', provider: 'nvidia', description: 'Code specialist' },
  ];
}
