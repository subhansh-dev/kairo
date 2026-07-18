/**
 * Configuration types — typed config definitions.
 */

export interface ProviderConfig {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  models: string[];
  enabled: boolean;
  priority: number;
}

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  systemPrompt?: string;
  maxTokens: number;
  temperature: number;
  tools: string[];
}

export interface SessionConfig {
  id: string;
  name: string;
  agentId: string;
  workspaceRoot: string;
  createdAt: Date;
  lastActive: Date;
}

export interface AppConfig {
  version: string;
  providers: ProviderConfig[];
  agents: AgentConfig[];
  sessions: SessionConfig[];
  preferences: UserPreferences;
}

export interface UserPreferences {
  theme: 'dark' | 'light';
  defaultProvider: string;
  defaultModel: string;
  compactMode: boolean;
  showTokenCount: boolean;
  autoCompact: boolean;
}

/**
 * Create default app config.
 */
export function defaultAppConfig(): AppConfig {
  return {
    version: '0.3.0',
    providers: [],
    agents: [],
    sessions: [],
    preferences: {
      theme: 'dark',
      defaultProvider: 'nvidia',
      defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b',
      compactMode: false,
      showTokenCount: true,
      autoCompact: true,
    },
  };
}

/**
 * Validate a provider config.
 */
export function validateProviderConfig(config: ProviderConfig): string[] {
  const errors: string[] = [];
  if (!config.id) errors.push('Provider ID is required');
  if (!config.name) errors.push('Provider name is required');
  if (config.models.length === 0) errors.push('At least one model is required');
  if (config.priority < 0) errors.push('Priority must be non-negative');
  return errors;
}

/**
 * Validate an agent config.
 */
export function validateAgentConfig(config: AgentConfig): string[] {
  const errors: string[] = [];
  if (!config.id) errors.push('Agent ID is required');
  if (!config.name) errors.push('Agent name is required');
  if (!config.model) errors.push('Model is required');
  if (config.maxTokens <= 0) errors.push('Max tokens must be positive');
  if (config.temperature < 0 || config.temperature > 2) errors.push('Temperature must be 0-2');
  return errors;
}
