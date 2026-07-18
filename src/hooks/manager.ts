/**
 * Kairo — Hooks System
 * Lifecycle interceptors for tool execution
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

export type HookType = 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'SessionEnd' | 'Stop';

export interface Hook {
  name: string;
  type: HookType;
  matcher: string; // tool name or '*' for all
  command: string;
  description?: string;
}

export interface HookResult {
  allowed: boolean;
  output?: string;
  modifiedInput?: string;
}

export class HookManager {
  private hooks: Hook[] = [];

  constructor(projectDir?: string) {
    this.loadHooks(projectDir);
  }

  private loadHooks(projectDir?: string) {
    // Load from ~/.kairo/hooks.json
    const userHooksPath = join(homedir(), '.kairo', 'hooks.json');
    if (existsSync(userHooksPath)) {
      try {
        const hooks = JSON.parse(readFileSync(userHooksPath, 'utf-8'));
        this.hooks.push(...(hooks.hooks || []));
      } catch {}
    }

    // Load from project .kairo/hooks.json
    if (projectDir) {
      const projectHooksPath = join(projectDir, '.kairo', 'hooks.json');
      if (existsSync(projectHooksPath)) {
        try {
          const hooks = JSON.parse(readFileSync(projectHooksPath, 'utf-8'));
          this.hooks.push(...(hooks.hooks || []));
        } catch {}
      }
    }

    // Load from Kairo settings (~/.claude/settings.json)
    const claudeSettingsPath = join(homedir(), '.claude', 'settings.json');
    if (existsSync(claudeSettingsPath)) {
      try {
        const settings = JSON.parse(readFileSync(claudeSettingsPath, 'utf-8'));
        if (settings.hooks) {
          for (const [type, hookList] of Object.entries(settings.hooks)) {
            for (const hookGroup of hookList as any[]) {
              for (const hook of hookGroup.hooks || []) {
                this.hooks.push({
                  name: `claude-${type}`,
                  type: type as HookType,
                  matcher: hookGroup.matcher || '*',
                  command: hook.command,
                  description: hookGroup.description,
                });
              }
            }
          }
        }
      } catch {}
    }
  }

  async runHooks(type: HookType, toolName: string, input?: string): Promise<HookResult> {
    const matching = this.hooks.filter(h => 
      h.type === type && (h.matcher === '*' || h.matcher === toolName || toolName.match(h.matcher))
    );

    for (const hook of matching) {
      try {
        const env = {
          ...process.env,
          KAIRO_TOOL_NAME: toolName,
          KAIRO_TOOL_INPUT: input || '',
          KAIRO_HOOK_TYPE: type,
        };

        const output = execSync(hook.command, { 
          encoding: 'utf-8', 
          timeout: 10000,
          env,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        // Check if hook blocked the operation
        if (output.includes('BLOCKED') || output.includes('blocked')) {
          return { allowed: false, output: output.trim() };
        }

        return { allowed: true, output: output.trim() };
      } catch (err: any) {
        // Hook exited with non-zero = block
        if (err.status === 2) {
          return { allowed: false, output: err.stderr || err.stdout || 'Hook blocked operation' };
        }
        // Other errors: continue (don't block on hook failures)
      }
    }

    return { allowed: true };
  }

  async runPreTool(toolName: string, input: string): Promise<HookResult> {
    return this.runHooks('PreToolUse', toolName, input);
  }

  async runPostTool(toolName: string, input: string, output: string): Promise<HookResult> {
    return this.runHooks('PostToolUse', toolName, `${input}\n---\n${output}`);
  }

  async runSessionStart(): Promise<void> {
    await this.runHooks('SessionStart', '*');
  }

  async runSessionEnd(): Promise<void> {
    await this.runHooks('SessionEnd', '*');
  }

  getHooks(): Hook[] {
    return this.hooks;
  }

  // ─── Hook Chains ─────────────────────────────

  /**
   * Run a chain of hooks, stopping on first block
   */
  async runHookChain(type: HookType, toolName: string, input?: string): Promise<HookResult> {
    const matching = this.hooks.filter(h =>
      h.type === type && (h.matcher === '*' || h.matcher === toolName || toolName.match(h.matcher))
    );

    const results: HookResult[] = [];

    for (const hook of matching) {
      const result = await this.runSingleHook(hook, toolName, input);
      results.push(result);

      // Stop on first block
      if (!result.allowed) {
        return {
          allowed: false,
          output: results.map(r => r.output).filter(Boolean).join('\n'),
        };
      }
    }

    return {
      allowed: true,
      output: results.map(r => r.output).filter(Boolean).join('\n'),
    };
  }

  private async runSingleHook(hook: Hook, toolName: string, input?: string): Promise<HookResult> {
    try {
      const env = {
        ...process.env,
        KAIRO_TOOL_NAME: toolName,
        KAIRO_TOOL_INPUT: input || '',
        KAIRO_HOOK_TYPE: hook.type,
      };

      const output = execSync(hook.command, {
        encoding: 'utf-8',
        timeout: 10000,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (output.includes('BLOCKED') || output.includes('blocked')) {
        return { allowed: false, output: output.trim() };
      }

      return { allowed: true, output: output.trim() };
    } catch (err: any) {
      if (err.status === 2) {
        return { allowed: false, output: err.stderr || err.stdout || 'Hook blocked operation' };
      }
      return { allowed: true };
    }
  }

  // ─── Async Hook Registry ─────────────────────

  private pendingAsync = new Map<string, { hook: Hook; startTime: number }>();

  /**
   * Start an async hook (returns immediately, checks later)
   */
  startAsyncHook(hookId: string, hook: Hook, toolName: string, input?: string): void {
    this.pendingAsync.set(hookId, { hook, startTime: Date.now() });
    // Fire and forget
    this.runSingleHook(hook, toolName, input).catch(() => {});
  }

  /**
   * Check if async hook is still running
   */
  isAsyncHookRunning(hookId: string): boolean {
    return this.pendingAsync.has(hookId);
  }

  /**
   * Cancel async hook
   */
  cancelAsyncHook(hookId: string): void {
    this.pendingAsync.delete(hookId);
  }

  // ─── SSRF Guard ──────────────────────────────

  /**
   * Check if a URL is safe to fetch (blocks internal IPs)
   */
  isSafeUrl(url: string): boolean {
    try {
      const parsed = new URL(url);

      // Block internal addresses
      const hostname = parsed.hostname;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '::1' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('169.254.') ||
        hostname.endsWith('.internal') ||
        hostname.endsWith('.local')
      ) {
        return false;
      }

      // Check 172.16.0.0/12 range properly (172.16.x.x - 172.31.x.x)
      if (hostname.startsWith('172.')) {
        const parts = hostname.split('.');
        if (parts.length >= 2) {
          const second = parseInt(parts[1], 10);
          if (second >= 16 && second <= 31) return false;
        }
      }

      return true;
    } catch {
      return false;
    }
  }

  // ─── Hook Statistics ───────────────────────────────────────────

  getHookStats(): { total: number; byType: Record<string, number>; pendingAsync: number } {
    const byType: Record<string, number> = {};
    for (const hook of this.hooks) {
      byType[hook.type] = (byType[hook.type] || 0) + 1;
    }
    return {
      total: this.hooks.length,
      byType,
      pendingAsync: this.pendingAsync.size,
    };
  }
}
