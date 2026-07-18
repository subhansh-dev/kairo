/**
 * Skills config — skill configuration management.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface SkillConfig {
  name: string;
  enabled: boolean;
  priority?: number;
  settings?: Record<string, unknown>;
}

const SKILLS_CONFIG_FILE = join(homedir(), '.kairo', 'skills-config.json');

/**
 * Load skills configuration.
 */
export function loadSkillsConfig(): Record<string, SkillConfig> {
  try {
    if (existsSync(SKILLS_CONFIG_FILE)) {
      return JSON.parse(readFileSync(SKILLS_CONFIG_FILE, 'utf-8'));
    }
  } catch { /* ok */ }
  return {};
}

/**
 * Save skills configuration.
 */
export function saveSkillsConfig(config: Record<string, SkillConfig>): void {
  try {
    const dir = join(homedir(), '.kairo');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(SKILLS_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch { /* best-effort */ }
}

/**
 * Enable/disable a skill.
 */
export function toggleSkill(name: string, enabled: boolean): void {
  const config = loadSkillsConfig();
  if (!config[name]) {
    config[name] = { name, enabled };
  } else {
    config[name].enabled = enabled;
  }
  saveSkillsConfig(config);
}

/**
 * Get skill config.
 */
export function getSkillConfig(name: string): SkillConfig | undefined {
  return loadSkillsConfig()[name];
}

/**
 * Check if a skill is enabled.
 */
export function isSkillEnabled(name: string): boolean {
  const config = getSkillConfig(name);
  return config ? config.enabled : true; // Enabled by default
}
