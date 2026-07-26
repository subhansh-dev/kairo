/**
 * Kairo — Provider Registry (Enhanced)
 * Multi-provider registry with dialect support, auto-discovery, and failover
 */

import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import { EnhancedProvider } from './enhanced.js';
import { getCredentialPool } from './credential-pool.js';
import type { Provider, ProviderConfig, Dialect } from './types.js';
import { getDialectForProvider } from './dialects/index.js';

// Re-export types for backward compatibility
export type { Provider, Message as ChatMessage } from './types.js';
export { ProviderError } from './types.js';

// ─── Config Loading ─────────────────────────────────────────────

interface ProviderConfigEntry {
  baseUrl?: string;
  apiKey?: string;
  apiKeys?: string[];
  models?: string[];
  dialect?: string;
  rateLimit?: { requestsPerMinute: number; tokensPerMinute: number };
}

interface ModelsConfig {
  providers?: Record<string, ProviderConfigEntry>;
  defaults?: {
    provider?: string;
    model?: string;
    thinkingModel?: string;
    fastModel?: string;
  };
}

function loadConfig(): ModelsConfig {
  const paths = [
    join(homedir(), '.kairo', 'models.yml'),
    join(homedir(), '.kairo', 'models.yaml'),
    join(homedir(), '.kairo', 'models.json'),
  ];
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf-8');
        return p.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);
      } catch { /* continue */ }
    }
  }
  return {};
}

function loadRumiKeys(): Record<string, string[]> {
  const rumiPaths = [
    join(homedir(), 'Desktop', 'rumi', 'config', 'api_keys.json'),
    join(homedir(), 'Desktop', 'rumi', 'config', 'api_keys.yml'),
  ];
  for (const p of rumiPaths) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf-8');
        const data = p.endsWith('.json') ? JSON.parse(raw) : parseYaml(raw);
        const keys: Record<string, string[]> = {};
        if (data.nvidia_api_key) keys.nvidia = [data.nvidia_api_key];
        return keys;
      } catch { /* continue */ }
    }
  }
  return {};
}

function envKey(name: string): string | undefined {
  const keyMap: Record<string, string[]> = {
    nvidia: ['NVIDIA_API_KEY', 'NVIDIA_NIM_API_KEY'],
    groq: ['GROQ_API_KEY'],
    cerebras: ['CEREBRAS_API_KEY'],
  };
  for (const envName of keyMap[name] || []) {
    const val = process.env[envName];
    if (val) return val;
  }
  return undefined;
}

const PROVIDER_DEFAULTS: Record<string, { baseUrl: string; models: string[] }> = {
  nvidia: {
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    models: ['nvidia/nemotron-3-ultra-550b-a55b'],
  },
  groq: {
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
  },
  cerebras: {
    baseUrl: 'https://api.cerebras.ai/v1',
    models: ['gpt-oss-120b', 'gemma-4-31b'],
  },
};

// ─── Registry ───────────────────────────────────────────────────

export class ProviderRegistry {
  private providers = new Map<string, EnhancedProvider>();
  private config: ModelsConfig;

  constructor() {
    this.config = loadConfig();
    this.discover();
  }

  private discover() {
    const configured = this.config.providers || {};
    const rumiKeys = loadRumiKeys();
    const pool = getCredentialPool();

    for (const [name, defaults] of Object.entries(PROVIDER_DEFAULTS)) {
      const cfg = configured[name];
      const baseUrl = cfg?.baseUrl || defaults.baseUrl;
      const models = cfg?.models || defaults.models;
      const dialect = cfg?.dialect ? getDialectForProvider(cfg.dialect) : undefined;

      // Collect all API keys for this provider
      const allKeys: string[] = [];
      const cfgKeys = cfg?.apiKeys || (cfg?.apiKey ? [cfg.apiKey] : []);
      for (const k of cfgKeys) if (k) allKeys.push(k.replace(/"/g, ''));
      const envK = envKey(name);
      if (envK && !allKeys.includes(envK)) allKeys.push(envK);
      const rumiK = rumiKeys[name];
      if (rumiK) for (const k of rumiK) if (!allKeys.includes(k)) allKeys.push(k);

      if (allKeys.length > 0) {
        // Add all keys to credential pool
        for (const key of allKeys) {
          pool.add(name, key);
        }

        // Create provider with first key (pool handles rotation)
        this.providers.set(name, new EnhancedProvider({
          name,
          baseUrl,
          apiKey: allKeys[0],
          apiKeys: allKeys,
          models,
          dialect,
          rateLimit: cfg?.rateLimit,
        }));
      }
    }
  }

  get(name: string): EnhancedProvider | undefined {
    return this.providers.get(name);
  }

  getAll(): EnhancedProvider[] {
    return Array.from(this.providers.values());
  }

  getAvailable(): string[] {
    return Array.from(this.providers.keys());
  }

  resolve(route: string): { provider: EnhancedProvider; model: string } | undefined {
    const parts = route.split('/');
    if (parts.length < 2) return undefined;
    const provider = this.providers.get(parts[0]);
    if (!provider) return undefined;
    return { provider, model: parts.slice(1).join('/') };
  }

  /** Get the default provider/model from config */
  getDefaults(): { provider: string; model: string; thinkingModel: string; fastModel: string } {
    return {
      provider: this.config.defaults?.provider || 'nvidia',
      model: this.config.defaults?.model || 'nvidia/nemotron-3-ultra-550b-a55b',
      thinkingModel: this.config.defaults?.thinkingModel || 'nvidia/nemotron-3-ultra-550b-a55b',
      fastModel: this.config.defaults?.fastModel || 'groq/gpt-oss-20b',
    };
  }

  /** Get raw provider configs (for secrets detection) */
  getConfigs(): Record<string, { apiKey?: string; apiKeys?: string[] }> {
    return this.config.providers || {};
  }

  /** Find best provider for a model ID */
  findModel(modelId: string): { provider: EnhancedProvider; model: string } | undefined {
    // Try exact match first
    for (const provider of this.providers.values()) {
      if (provider.models.includes(modelId)) {
        return { provider, model: modelId };
      }
    }
    // Try partial match
    for (const provider of this.providers.values()) {
      const match = provider.models.find(m => m.includes(modelId) || modelId.includes(m));
      if (match) return { provider, model: match };
    }
    return undefined;
  }
}

let _registry: ProviderRegistry | null = null;

export function getRegistry(): ProviderRegistry {
  if (!_registry) _registry = new ProviderRegistry();
  return _registry;
}
