import { HookEventName, HookEventEnvelope, isBlockingEvent, extractToolName } from './event.js';
import { HookSpec } from './config.js';
import { HookRegistry, isHookDisabled } from './registry.js';
import { spawn } from 'child_process';

// ─── Result Types ──────────────────────────────────────────

export type HookDecision =
  | { type: 'allow' }
  | { type: 'deny'; reason: string; hookName: string };

export type HookRunResult =
  | { type: 'success'; hookName: string; elapsed: number }
  | { type: 'failed'; hookName: string; error: string; elapsed: number }
  | { type: 'skipped'; hookName: string };

export interface PreToolUseResult {
  decision: HookDecision;
  results: HookRunResult[];
}

// ─── Runner ────────────────────────────────────────────────

interface RunContext {
  sessionId: string;
  workspaceRoot: string;
}

async function runHook(
  spec: HookSpec,
  envelope: HookEventEnvelope,
  ctx: RunContext,
  isBlocking: boolean,
): Promise<{ result: HookRunnerResult; httpInfo?: string }> {
  const start = Date.now();

  if (spec.handlerType === 'command' && spec.command) {
    return runCommandHook(spec, envelope, ctx, isBlocking, start);
  }

  if (spec.handlerType === 'http' && spec.url) {
    return runHttpHook(spec, envelope, ctx, isBlocking, start);
  }

  return {
    result: {
      type: 'failed',
      hookName: spec.name,
      error: 'No handler (command or url) configured',
      elapsed: Date.now() - start,
    },
  };
}

async function runCommandHook(
  spec: HookSpec,
  envelope: HookEventEnvelope,
  ctx: RunContext,
  isBlocking: boolean,
  start: number,
): Promise<{ result: HookRunnerResult }> {
  return new Promise((resolve) => {
    const input = JSON.stringify(envelope);
    const proc = spawn('sh', ['-c', spec.command!], {
      cwd: spec.sourceDir,
      timeout: spec.timeoutMs,
      env: {
        ...process.env,
        ...spec.extraEnv,
        KAIRO_SESSION_ID: ctx.sessionId,
        KAIRO_WORKSPACE_ROOT: ctx.workspaceRoot,
        KAIRO_HOOK_EVENT: envelope.hookEventName,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      const elapsed = Date.now() - start;
      const output = stdout.trim();

      if (isBlocking && output) {
        const decision = parseDecisionOutput(output);
        if (decision.type === 'deny') {
          resolve({ result: { type: 'failed', hookName: spec.name, error: `denied: ${decision.reason}`, elapsed } });
          return;
        }
      }

      if (code !== 0 && !output) {
        resolve({ result: { type: 'failed', hookName: spec.name, error: `exit code ${code}: ${stderr}`, elapsed } });
        return;
      }

      resolve({ result: { type: 'success', hookName: spec.name, elapsed } });
    });

    proc.on('error', (err: Error) => {
      const elapsed = Date.now() - start;
      resolve({ result: { type: 'failed', hookName: spec.name, error: err.message, elapsed } });
    });

    proc.stdin.write(input);
    proc.stdin.end();
  });
}

async function runHttpHook(
  spec: HookSpec,
  envelope: HookEventEnvelope,
  ctx: RunContext,
  isBlocking: boolean,
  start: number,
): Promise<{ result: HookRunnerResult; httpInfo?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), spec.timeoutMs);

    const response = await fetch(spec.url!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...spec.extraEnv,
      },
      body: JSON.stringify(envelope),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const elapsed = Date.now() - start;
    const output = await response.text();

    if (isBlocking) {
      const decision = parseDecisionOutput(output);
      if (decision.type === 'deny') {
        return {
          result: { type: 'failed', hookName: spec.name, error: `denied: ${decision.reason}`, elapsed },
          httpInfo: `${response.status} ${response.statusText}`,
        };
      }
    }

    return {
      result: { type: 'success', hookName: spec.name, elapsed },
      httpInfo: `${response.status} ${response.statusText}`,
    };
  } catch (err: any) {
    const elapsed = Date.now() - start;
    return {
      result: {
        type: 'failed',
        hookName: spec.name,
        error: err.message ?? String(err),
        elapsed,
      },
    };
  }
}

function parseDecisionOutput(output: string): HookDecision {
  try {
    const parsed = JSON.parse(output);
    if (parsed.decision === 'deny') {
      return { type: 'deny', reason: parsed.reason ?? 'denied by hook', hookName: '' };
    }
    return { type: 'allow' };
  } catch {
    return { type: 'allow' };
  }
}

type HookRunnerResult = { type: 'success'; hookName: string; elapsed: number }
  | { type: 'failed'; hookName: string; error: string; elapsed: number };

// ─── Dispatch Functions ────────────────────────────────────

/**
 * Dispatch a pre_tool_use event (blocking — can deny).
 * Fail-open: hook failures don't block the tool call.
 */
export async function dispatchPreToolUse(
  registry: HookRegistry,
  envelope: HookEventEnvelope,
  ctx: RunContext,
): Promise<PreToolUseResult> {
  const hooks = registry.hooksFor(HookEventName.PreToolUse);
  if (hooks.length === 0) {
    return { decision: { type: 'allow' }, results: [] };
  }

  const toolName = extractToolName(envelope.payload);
  const results: HookRunResult[] = [];

  for (const spec of hooks) {
    if (!spec.enabled || isHookDisabled(spec.name)) {
      results.push({ type: 'skipped', hookName: spec.name });
      continue;
    }

    // Check matcher against tool name
    if (spec.matcher && toolName && !spec.matcher.test(toolName)) {
      continue;
    }

    const { result } = await runHook(spec, envelope, ctx, true);

    if (result.type === 'failed' && result.error.startsWith('denied:')) {
      results.push(result);
      return {
        decision: {
          type: 'deny',
          reason: result.error.slice(8),
          hookName: spec.name,
        },
        results,
      };
    }

    results.push(result);
  }

  return { decision: { type: 'allow' }, results };
}

/**
 * Dispatch a non-blocking event (session_start, post_tool_use, etc.).
 * Never denies — callers log results and continue.
 */
export async function dispatchNonBlocking(
  registry: HookRegistry,
  event: HookEventName,
  envelope: HookEventEnvelope,
  ctx: RunContext,
): Promise<HookRunResult[]> {
  const hooks = registry.hooksFor(event);
  if (hooks.length === 0) return [];

  const toolName = extractToolName(envelope.payload);
  const results: HookRunResult[] = [];

  for (const spec of hooks) {
    if (!spec.enabled || isHookDisabled(spec.name)) {
      results.push({ type: 'skipped', hookName: spec.name });
      continue;
    }

    // Check matcher
    if (spec.matcher && toolName && !spec.matcher.test(toolName)) {
      continue;
    }

    const { result } = await runHook(spec, envelope, ctx, false);
    results.push(result);
  }

  return results;
}
