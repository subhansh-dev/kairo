/**
 * Kairo — Configuration Utilities
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';

export function loadConfig<T>(name: string, formats: string[] = ['yml', 'yaml', 'json']): T | null {
  const dirs = [
    join(homedir(), '.kairo'),
    join(homedir(), '.config', 'kairo'),
    process.cwd(),
  ];

  for (const dir of dirs) {
    for (const ext of formats) {
      const path = join(dir, `${name}.${ext}`);
      if (!existsSync(path)) continue;
      try {
        const raw = readFileSync(path, 'utf-8');
        if (ext === 'json') return JSON.parse(raw) as T;
        return parseYaml(raw) as T;
      } catch {}
    }
  }

  return null;
}

export function loadConfigFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    if (path.endsWith('.json')) return JSON.parse(raw) as T;
    return parseYaml(raw) as T;
  } catch {
    return null;
  }
}

export function getHomeConfigDir(): string {
  return join(homedir(), '.kairo');
}

export function getProjectConfigDir(projectDir?: string): string {
  return join(projectDir || process.cwd(), '.kairo');
}

export function ensureConfigDir(dir?: string): void {
  const target = dir || getHomeConfigDir();
  if (!existsSync(target)) {
    mkdirSync(target, { recursive: true });
  }
}

// ─── Kairo Config ─────────────────────────────

export interface KairoConfig {
  defaultModel?: string
  defaultProvider?: string
  permissionMode?: 'always' | 'moderate' | 'strict' | 'auto'
  autoCompact?: boolean
  maxTokens?: number
  systemPrompt?: string
  mcpConfig?: string
  hooksConfig?: string
  theme?: 'dark' | 'light'
  debug?: boolean
  metadata?: Record<string, unknown>
}

const CONFIG_FILE = 'config.json'

/**
 * Load merged configuration (user + project)
 */
export function loadKairoConfig(projectDir?: string): KairoConfig {
  const config: KairoConfig = {}

  // User config
  const userConfig = loadConfigFile<KairoConfig>(join(getHomeConfigDir(), CONFIG_FILE))
  if (userConfig) Object.assign(config, userConfig)

  // Project config (overrides user)
  if (projectDir) {
    const projectConfig = loadConfigFile<KairoConfig>(join(projectDir, '.kairo', CONFIG_FILE))
    if (projectConfig) Object.assign(config, projectConfig)
  }

  return config
}

/**
 * Save user configuration
 */
export function saveKairoConfig(config: KairoConfig): void {
  ensureConfigDir()
  writeFileSync(join(getHomeConfigDir(), CONFIG_FILE), JSON.stringify(config, null, 2))
}

/**
 * Get a specific config value with default
 */
export function getConfigValue<T>(key: keyof KairoConfig, defaultValue: T, projectDir?: string): T {
  const config = loadKairoConfig(projectDir)
  return (config[key] as T) ?? defaultValue
}

/**
 * Set a specific config value
 */
export function setConfigValue(key: keyof KairoConfig, value: unknown): void {
  const config = loadKairoConfig()
  ;(config as Record<string, unknown>)[key] = value
  saveKairoConfig(config)
}

// ─── Path Helpers ────────────────────────────────────────────────

export function getMemoryPath(): string { return join(getHomeConfigDir(), 'memory') }
export function getSessionsPath(): string { return join(getHomeConfigDir(), 'sessions') }
export function getGoalsPath(): string { return join(getHomeConfigDir(), 'goals') }
export function getTasksPath(): string { return join(getHomeConfigDir(), 'tasks') }
export function getAgentsPath(): string { return join(getHomeConfigDir(), 'agents') }
export function getSkillsPath(): string { return join(getHomeConfigDir(), 'skills') }
export function getHooksPath(): string { return join(getHomeConfigDir(), 'hooks.json') }
