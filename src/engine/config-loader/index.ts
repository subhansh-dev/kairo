/**
 * Config loader — configuration file loading, validation, and overrides.
 * Ported from the Rust config crate.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─── Config Types ──────────────────────────────────────────

export interface KairoConfig {
  version: string;
  providers: ConfigProviderEntry[];
  agents: ConfigAgentEntry[];
  hooks: HookEntry[];
  preferences: Preferences;
  overrides: ConfigOverrides;
}

export interface ConfigProviderEntry {
  id: string;
  name: string;
  apiKey?: string;
  baseUrl?: string;
  models: string[];
  enabled: boolean;
  priority: number;
}

export interface ConfigAgentEntry {
  id: string;
  name: string;
  model: string;
  systemPrompt?: string;
  maxTokens: number;
  temperature: number;
}

export interface HookEntry {
  name: string;
  event: string;
  type: 'command' | 'http';
  enabled: boolean;
  command?: string;
  url?: string;
  timeout?: number;
}

export interface Preferences {
  theme: 'dark' | 'light';
  defaultProvider: string;
  defaultModel: string;
  compactMode: boolean;
  showTokenCount: boolean;
}

export interface ConfigOverrides {
  env: Record<string, string>;
  model?: string;
  temperature?: number;
}

// ─── Config Paths ──────────────────────────────────────────

export function getConfigPaths(): {
  userConfigDir: string;
  userConfigFile: string;
  projectConfigDir: string;
  projectConfigFile: string;
} {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const userConfigDir = path.join(home, '.kairo');
  const userConfigFile = path.join(userConfigDir, 'config.json');
  const projectConfigDir = '.kairo';
  const projectConfigFile = path.join(projectConfigDir, 'config.json');

  return { userConfigDir, userConfigFile, projectConfigDir, projectConfigFile };
}

// ─── Config Loading ────────────────────────────────────────

export function defaultConfig(): KairoConfig {
  return {
    version: '0.3.0',
    providers: [],
    agents: [],
    hooks: [],
    preferences: {
      theme: 'dark',
      defaultProvider: 'nvidia',
      defaultModel: 'nvidia/nemotron-3-ultra-550b-a55b',
      compactMode: false,
      showTokenCount: true,
    },
    overrides: { env: {} },
  };
}

/**
 * Load config from file, merging user and project configs.
 */
export function loadConfig(projectRoot?: string): KairoConfig {
  const paths = getConfigPaths();
  let config = defaultConfig();

  // Load user config
  const userConfig = readJsonFile<KairoConfig>(paths.userConfigFile);
  if (userConfig) {
    config = mergeConfigs(config, userConfig);
  }

  // Load project config
  if (projectRoot) {
    const projectFile = path.join(projectRoot, paths.projectConfigFile);
    const projectConfig = readJsonFile<KairoConfig>(projectFile);
    if (projectConfig) {
      config = mergeConfigs(config, projectConfig);
    }
  }

  return config;
}

/**
 * Save config to file.
 */
export function saveConfig(config: KairoConfig, isProject: boolean = false): boolean {
  const paths = getConfigPaths();
  const filePath = isProject ? paths.projectConfigFile : paths.userConfigFile;

  if (!isProject) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  try {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ─── Config Validation ─────────────────────────────────────

export function validateConfig(config: KairoConfig): string[] {
  const errors: string[] = [];

  if (!config.version) errors.push('Version is required');

  for (const provider of config.providers) {
    if (!provider.id) errors.push('Provider ID is required');
    if (!provider.name) errors.push(`Provider name is required for ${provider.id}`);
    if (provider.models.length === 0) errors.push(`Provider ${provider.id} needs at least one model`);
  }

  for (const agent of config.agents) {
    if (!agent.id) errors.push('Agent ID is required');
    if (!agent.model) errors.push(`Agent ${agent.id} needs a model`);
    if (agent.maxTokens <= 0) errors.push(`Agent ${agent.id} maxTokens must be positive`);
  }

  return errors;
}

// ─── Config Overrides ──────────────────────────────────────

export function applyOverrides(config: KairoConfig, overrides: ConfigOverrides): KairoConfig {
  const result = { ...config, overrides: { ...config.overrides, ...overrides } };

  if (overrides.model) {
    for (const agent of result.agents) {
      agent.model = overrides.model;
    }
  }

  if (overrides.temperature !== undefined) {
    for (const agent of result.agents) {
      agent.temperature = overrides.temperature;
    }
  }

  return result;
}

// ─── Version Overrides ─────────────────────────────────────

export interface VersionOverride {
  minVersion: string;
  maxVersion?: string;
  features: Record<string, boolean>;
}

export function checkVersionOverrides(
  config: KairoConfig,
  currentVersion: string,
  overrides: VersionOverride[],
): Record<string, boolean> {
  const features: Record<string, boolean> = {};

  for (const override of overrides) {
    if (compareVersions(currentVersion, override.minVersion) >= 0) {
      if (!override.maxVersion || compareVersions(currentVersion, override.maxVersion) <= 0) {
        Object.assign(features, override.features);
      }
    }
  }

  return features;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

// ─── Atomic File Operations ────────────────────────────────

export function writeAtomic(filePath: string, content: string): boolean {
  try {
    const tmpPath = `${filePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return true;
  } catch {
    return false;
  }
}

// ─── Helpers ───────────────────────────────────────────────

function readJsonFile<T>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

function mergeConfigs(base: KairoConfig, override: Partial<KairoConfig>): KairoConfig {
  return {
    ...base,
    ...override,
    providers: override.providers ?? base.providers,
    agents: override.agents ?? base.agents,
    hooks: override.hooks ?? base.hooks,
    preferences: { ...base.preferences, ...override.preferences },
    overrides: { ...base.overrides, ...override.overrides },
  };
}
