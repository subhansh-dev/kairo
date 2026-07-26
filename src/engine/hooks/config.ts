import { HookEventName, parseHookEventName } from './event.js';

// ─── Hook Spec ─────────────────────────────────────────────

export interface HookSpec {
  name: string;
  event: HookEventName;
  handlerType: 'command' | 'http';
  matcher?: RegExp;
  configuredMatcher?: string;
  enabled: boolean;
  command?: string;
  url?: string;
  timeoutMs: number;
  sourceDir: string;
  extraEnv: Record<string, string>;
}

// ─── Config Parsing ────────────────────────────────────────

export interface HookConfigFile {
  hooks?: HookConfigEntry[];
}

export interface HookConfigEntry {
  name: string;
  event: string;
  type?: 'command' | 'http';
  matcher?: string;
  enabled?: boolean;
  command?: string;
  url?: string;
  timeout?: number;
  env?: Record<string, string>;
}

/**
 * Parse a hook config file (JSON format).
 */
export function parseHookConfig(data: HookConfigFile, sourceDir: string): HookSpec[] {
  const specs: HookSpec[] = [];
  if (!data.hooks) return specs;

  for (const entry of data.hooks) {
    const event = parseHookEventName(entry.event);
    if (!event) continue;

    const handlerType = entry.type ?? (entry.url ? 'http' : 'command');
    const matcher = entry.matcher ? new RegExp(entry.matcher) : undefined;

    specs.push({
      name: entry.name,
      event,
      handlerType,
      matcher,
      configuredMatcher: entry.matcher,
      enabled: entry.enabled ?? true,
      command: entry.command,
      url: entry.url,
      timeoutMs: entry.timeout ?? 10_000,
      sourceDir,
      extraEnv: entry.env ?? {},
    });
  }

  return specs;
}
