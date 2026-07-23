/**
 * Kairo — Delegation System
 * Isolated subagent spawning with restricted toolsets.
 * Ported from Hermes Agent's delegate_tool.py
 *
 * Spawns child agent instances with isolated context, restricted toolsets,
 * and their own execution context. The parent blocks until all children complete.
 *
 * Each child gets:
 *   - A fresh conversation (no parent history)
 *   - Its own task ID
 *   - A restricted toolset (configurable)
 *   - A focused system prompt built from the delegated goal + context
 */

import { toolRegistry } from '../tools/index.js';
import type { ToolResult } from '../tools/types.js';
import { runAgent, type RunAgentOptions, type AgentRunResult } from '../agents/orchestrator.js';

// ─── Types ──────────────────────────────────────────────────────

export interface DelegationConfig {
  /** Agent to delegate to */
  agent: string;
  /** Task description */
  task: string;
  /** Tools the child can use (null = all except blocked) */
  allowedTools?: string[];
  /** Tools the child must never have */
  blockedTools?: string[];
  /** Maximum turns for the child */
  maxTurns?: number;
  /** Additional context to inject */
  context?: string;
  /** Timeout in ms */
  timeoutMs?: number;
}

export interface DelegationResult {
  agent: string;
  task: string;
  output: string;
  success: boolean;
  toolCalls: number;
  duration: number;
  error?: string;
}

export interface BatchDelegationConfig {
  tasks: DelegationConfig[];
  maxConcurrency: number;
}

// ─── Blocked Tools ──────────────────────────────────────────────

const DELEGATE_BLOCKED_TOOLS = new Set([
  'delegate',       // no recursive delegation
  'clarify',        // no user interaction in subagents
  'send_message',   // no cross-platform side effects
  'cron',           // no scheduling in parent's name
]);

// ─── Core Functions ─────────────────────────────────────────────

/**
 * Delegate a task to a subagent with isolated context.
 */
export async function delegateTask(config: DelegationConfig): Promise<DelegationResult> {
  const startTime = Date.now();
  const blockedTools = new Set([...DELEGATE_BLOCKED_TOOLS, ...(config.blockedTools || [])]);

  // Build restricted tool list
  const allowedTools = config.allowedTools
    ? new Set(config.allowedTools)
    : null;

  // Create filtered tool context for the subagent
  const toolContext = buildToolContext(allowedTools, blockedTools);

  // Build focused system prompt
  const systemPrompt = buildDelegationPrompt(config.task, config.context, toolContext);

  try {
    const agentPromise = runAgent(config.agent, config.task, {
      context: config.context,
      model: undefined, // use default routing
      systemPrompt,
      allowedTools: allowedTools ? [...allowedTools] : undefined,
      blockedTools: [...blockedTools],
    });

    // Enforce timeout if configured
    const result = config.timeoutMs
      ? await Promise.race([
          agentPromise,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Delegation timed out after ${config.timeoutMs}ms`)), config.timeoutMs)
          ),
        ])
      : await agentPromise;

    return {
      agent: config.agent,
      task: config.task,
      output: result.output,
      success: true,
      toolCalls: result.toolCalls.length,
      duration: Date.now() - startTime,
    };
  } catch (err: any) {
    return {
      agent: config.agent,
      task: config.task,
      output: '',
      success: false,
      toolCalls: 0,
      duration: Date.now() - startTime,
      error: err.message,
    };
  }
}

/**
 * Delegate multiple tasks in parallel (batch mode).
 */
export async function delegateBatch(config: BatchDelegationConfig): Promise<DelegationResult[]> {
  const results: DelegationResult[] = [];
  const sorted = [...config.tasks];

  // Process in waves
  for (let i = 0; i < sorted.length; i += config.maxConcurrency) {
    const wave = sorted.slice(i, i + config.maxConcurrency);
    const waveResults = await Promise.allSettled(
      wave.map(task => delegateTask(task))
    );

    for (const pr of waveResults) {
      if (pr.status === 'fulfilled') {
        results.push(pr.value);
      } else {
        results.push({
          agent: 'unknown',
          task: 'unknown',
          output: '',
          success: false,
          toolCalls: 0,
          duration: 0,
          error: pr.reason?.message || 'Unknown error',
        });
      }
    }
  }

  return results;
}

/**
 * Synthesize batch results into a coherent summary.
 */
export function synthesizeResults(results: DelegationResult[]): string {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  const lines: string[] = [];

  if (successful.length > 0) {
    lines.push(`## Successful Delegations (${successful.length})`);
    for (const r of successful) {
      lines.push(`### ${r.agent} (${(r.duration / 1000).toFixed(1)}s, ${r.toolCalls} tools)`);
      lines.push(r.output.slice(0, 500));
      if (r.output.length > 500) lines.push('... [truncated]');
      lines.push('');
    }
  }

  if (failed.length > 0) {
    lines.push(`## Failed Delegations (${failed.length})`);
    for (const r of failed) {
      lines.push(`### ${r.agent}: ${r.error}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── Helpers ────────────────────────────────────────────────────

function buildToolContext(allowed: Set<string> | null, blocked: Set<string>): string {
  const allTools = toolRegistry.getAll();
  const available: string[] = [];

  for (const tool of allTools) {
    if (blocked.has(tool.name)) continue;
    if (allowed && !allowed.has(tool.name)) continue;
    available.push(tool.name);
  }

  return `Available tools: ${available.join(', ')}`;
}

function buildDelegationPrompt(task: string, context: string | undefined, toolContext: string): string {
  const parts = [
    `You are a specialized subagent delegated to complete a specific task.`,
    `Task: ${task}`,
    '',
    toolContext,
    '',
    'Rules:',
    '- Focus only on your assigned task',
    '- Do not interact with the user directly',
    '- Do not modify files outside your task scope',
    '- Report your results clearly when done',
  ];

  if (context) {
    parts.push('', 'Context:', context);
  }

  return parts.join('\n');
}

/**
 * Get delegation statistics.
 */
export function getDelegationStats(results: DelegationResult[]): {
  total: number;
  successful: number;
  failed: number;
  totalDuration: number;
  totalToolCalls: number;
  avgDuration: number;
} {
  const successful = results.filter(r => r.success);
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  const totalToolCalls = results.reduce((sum, r) => sum + r.toolCalls, 0);

  return {
    total: results.length,
    successful: successful.length,
    failed: results.length - successful.length,
    totalDuration,
    totalToolCalls,
    avgDuration: results.length > 0 ? totalDuration / results.length : 0,
  };
}
