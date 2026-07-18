import { HookEventName, isLifecycleEvent } from './event.js';
import { HookSpec, HookConfigFile, parseHookConfig } from './config.js';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Registry ──────────────────────────────────────────────

export class HookRegistry {
  private hooks = new Map<HookEventName, HookSpec[]>();

  constructor() {
    for (const event of Object.values(HookEventName)) {
      this.hooks.set(event as HookEventName, []);
    }
  }

  /** Add a spec to the registry */
  add(spec: HookSpec): void {
    const list = this.hooks.get(spec.event) ?? [];
    list.push(spec);
    this.hooks.set(spec.event, list);
  }

  /** Append multiple specs */
  appendSpecs(specs: HookSpec[]): void {
    for (const spec of specs) this.add(spec);
  }

  /** Get hooks for a specific event */
  hooksFor(event: HookEventName): HookSpec[] {
    return this.hooks.get(event) ?? [];
  }

  /** Get all registered hooks */
  allHooks(): HookSpec[] {
    return Array.from(this.hooks.values()).flat();
  }

  /** Get all enabled hooks */
  enabledHooks(): HookSpec[] {
    return this.allHooks().filter(h => h.enabled);
  }
}

// ─── Discovery ─────────────────────────────────────────────

/**
 * Load hooks from user and project directories.
 * Returns [registry, errors].
 */
export function loadHooks(
  userHooksDir?: string | null,
  projectHooksDir?: string | null,
): [HookRegistry, string[]] {
  const registry = new HookRegistry();
  const errors: string[] = [];

  // User hooks (~/.kairo/hooks/)
  const resolvedUserDir = userHooksDir ?? join(homedir(), '.kairo', 'hooks');
  loadHooksFromDir(registry, resolvedUserDir, errors);

  // Project hooks (.kairo/hooks/)
  if (projectHooksDir) {
    loadHooksFromDir(registry, projectHooksDir, errors);
  }

  return [registry, errors];
}

function loadHooksFromDir(registry: HookRegistry, dir: string, errors: string[]): void {
  if (!existsSync(dir)) return;

  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      try {
        const raw = readFileSync(join(dir, file), 'utf-8');
        const config: HookConfigFile = JSON.parse(raw);
        const specs = parseHookConfig(config, dir);
        registry.appendSpecs(specs);
      } catch (err: any) {
        errors.push(`Failed to load hook ${file}: ${err.message}`);
      }
    }
  } catch (err: any) {
    errors.push(`Failed to read hooks dir ${dir}: ${err.message}`);
  }
}

// ─── Trust ─────────────────────────────────────────────────

const disabledHooks = new Set<string>();

export function disableHook(name: string): void {
  disabledHooks.add(name);
}

export function enableHook(name: string): void {
  disabledHooks.delete(name);
}

export function isHookDisabled(name: string): boolean {
  return disabledHooks.has(name);
}
