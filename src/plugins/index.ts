/**
 * Kairo — Plugin System
 * Pluggable memory providers, context engines, and tool middleware
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, watch } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Plugin Types ─────────────────────────────────────────

export type PluginType = 'memory' | 'context' | 'provider' | 'tool' | 'hook' | 'theme' | 'auth';

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  type: PluginType;
  entry: string;
  author?: string;
  homepage?: string;
  requires?: string[];
  config?: Record<string, unknown>;
}

export interface Plugin {
  manifest: PluginManifest;
  loaded: boolean;
  enabled: boolean;
  loadError?: string;
}

// ─── Plugin Registry ──────────────────────────────────────

const PLUGINS_DIR = join(homedir(), '.kairo', 'plugins');
const MANIFEST_FILE = join(PLUGINS_DIR, 'plugins.json');

let plugins = new Map<string, Plugin>();
let initialized = false;

function ensurePluginsDir(): void {
  if (!existsSync(PLUGINS_DIR)) mkdirSync(PLUGINS_DIR, { recursive: true });
}

function loadManifest(): void {
  ensurePluginsDir();
  if (!existsSync(MANIFEST_FILE)) {
    saveManifest();
    return;
  }
  try {
    const data = JSON.parse(readFileSync(MANIFEST_FILE, 'utf-8'));
    plugins.clear();
    for (const plugin of data.plugins || []) {
      plugins.set(plugin.manifest.name, plugin);
    }
  } catch {
    saveManifest();
  }
}

function saveManifest(): void {
  ensurePluginsDir();
  writeFileSync(MANIFEST_FILE, JSON.stringify({
    version: 1,
    plugins: Array.from(plugins.values()),
    updatedAt: Date.now(),
  }, null, 2));
}

// ─── Plugin API ───────────────────────────────────────────

export function initPluginSystem(): void {
  if (initialized) return;
  loadManifest();
  autoDiscover();
  loadEnabledPlugins();
  initialized = true;
}

function loadEnabledPlugins(): void {
  for (const [name, plugin] of plugins) {
    if (!plugin.enabled || plugin.loaded) continue;
    try {
      const pluginDir = join(PLUGINS_DIR, name);
      const entryPath = join(pluginDir, plugin.manifest.entry);
      if (!existsSync(entryPath)) {
        plugin.loadError = `Entry file not found: ${plugin.manifest.entry}`;
        continue;
      }
      // Mark as loaded (actual module loading happens lazily on first use)
      plugin.loaded = true;
    } catch (e: any) {
      plugin.loadError = e.message;
    }
  }
}

export function getPlugin(name: string): Plugin | undefined {
  return plugins.get(name);
}

export function getAllPlugins(type?: PluginType): Plugin[] {
  const all = Array.from(plugins.values());
  return type ? all.filter(p => p.manifest.type === type) : all;
}

export function registerPlugin(manifest: PluginManifest): Plugin {
  const plugin: Plugin = { manifest, loaded: false, enabled: true };
  plugins.set(manifest.name, plugin);
  saveManifest();
  return plugin;
}

export function enablePlugin(name: string): boolean {
  const plugin = plugins.get(name);
  if (!plugin) return false;
  plugin.enabled = true;
  saveManifest();
  return true;
}

export function disablePlugin(name: string): boolean {
  const plugin = plugins.get(name);
  if (!plugin) return false;
  plugin.enabled = false;
  saveManifest();
  return true;
}

export function removePlugin(name: string): boolean {
  const existed = plugins.delete(name);
  if (existed) saveManifest();
  return existed;
}

// ─── Auto-Discovery ───────────────────────────────────────

function autoDiscover(): void {
  ensurePluginsDir();
  const entries = readdirSync(PLUGINS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = join(PLUGINS_DIR, entry.name, 'plugin.json');
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (!plugins.has(manifest.name)) {
        registerPlugin(manifest);
      }
    } catch {}
  }
}

// ─── Plugin Hooks ─────────────────────────────────────────

export interface PluginHookMap {
  preToolCall?: (toolName: string, args: string) => { allowed: boolean; reason?: string } | null;
  postToolCall?: (toolName: string, args: string, result: string) => void;
  preResponse?: (response: string) => string;
  postResponse?: (response: string) => void;
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
}

const hookRegistry = new Map<string, PluginHookMap>();

export function registerPluginHooks(pluginName: string, hooks: PluginHookMap): void {
  hookRegistry.set(pluginName, hooks);
}

export function unregisterPluginHooks(pluginName: string): void {
  hookRegistry.delete(pluginName);
}

export function runPreToolHooks(toolName: string, args: string): { allowed: boolean; reason?: string } {
  for (const [, hooks] of hookRegistry) {
    if (hooks.preToolCall) {
      const result = hooks.preToolCall(toolName, args);
      if (result !== null && !result.allowed) return result;
    }
  }
  return { allowed: true };
}

export function runPostToolHooks(toolName: string, args: string, result: string): void {
  for (const [, hooks] of hookRegistry) {
    if (hooks.postToolCall) {
      hooks.postToolCall(toolName, args, result);
    }
  }
}

export function runPreResponseHooks(response: string): string {
  let modified = response;
  for (const [, hooks] of hookRegistry) {
    if (hooks.preResponse) {
      modified = hooks.preResponse(modified);
    }
  }
  return modified;
}

export function runPostResponseHooks(response: string): void {
  for (const [, hooks] of hookRegistry) {
    if (hooks.postResponse) {
      hooks.postResponse(response);
    }
  }
}

export function runSessionStartHooks(): void {
  for (const [, hooks] of hookRegistry) {
    if (hooks.onSessionStart) hooks.onSessionStart();
  }
}

export function runSessionEndHooks(): void {
  for (const [, hooks] of hookRegistry) {
    if (hooks.onSessionEnd) hooks.onSessionEnd();
  }
}
