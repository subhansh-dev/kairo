import type { ToolDefinition, ToolResult, ToolRegistry } from './types.js';
import { checkToolCooldown, recordToolCall } from './types.js';
import type { MCPClient } from '../mcp/client.js';
import { bashTool } from './bash.js';
import { fileReadTool } from './file-read.js';
import { fileWriteTool } from './file-write.js';
import { fileEditTool } from './file-edit.js';
import { grepTool, globTool } from './search.js';
import { memoryTool } from './memory.js';
import { webFetchTool, webSearchTool } from './web.js';
import { clarifyTool } from './clarify.js';
import { cronTool } from './cron.js';
import { lsTool } from './ls.js';
import { gitTool } from './git.js';
import { todoTool } from './todo.js';
import { enterPlanModeTool, writePlanTool, exitPlanModeTool } from './plan.js';
import { sessionSearchTool } from './session-search.js';
import { notebookEditTool } from './notebook-edit.js';
import { hashlineTool } from './hashline.js';
import { taskCreateTool } from './task-create.js';
import { taskListTool } from './task-list.js';
import { taskGetTool } from './task-get.js';
import { taskUpdateTool } from './task-update.js';
import { taskOutputTool } from './task-output.js';
import { taskStopTool } from './task-stop.js';
import { agentTool } from './agent.js';
import { askUserTool } from './ask-user.js';
import { sendMessageTool } from './send-message.js';
import { discoverSkillsTool } from './discover-skills.js';
import { goalTool } from './goal.js';
import { ctxInspectTool } from './ctx-inspect.js';
import { sleepTool } from './sleep.js';
import { skillTool } from './skill.js';
import { snipTool } from './snip.js';
import { reviewArtifactTool } from './review-artifact.js';
import { suggestPRTool } from './suggest-pr.js';
import { proactiveTool } from './proactive.js';
import { advisorTool } from './advisor.js';
import { mentorTool } from './mentor.js';
import { extractToolCalls } from './types.js';

const ALL_TOOLS: ToolDefinition[] = [
  hashlineTool,
  fileReadTool,
  fileWriteTool,
  fileEditTool,
  bashTool,
  grepTool,
  globTool,
  lsTool,
  gitTool,
  webFetchTool,
  webSearchTool,
  memoryTool,
  todoTool,
  clarifyTool,
  cronTool,
  enterPlanModeTool,
  writePlanTool,
  exitPlanModeTool,
  sessionSearchTool,
  notebookEditTool,
  taskCreateTool,
  taskListTool,
  taskGetTool,
  taskUpdateTool,
  taskOutputTool,
  taskStopTool,
  agentTool,
  askUserTool,
  sendMessageTool,
  discoverSkillsTool,
  goalTool,
  ctxInspectTool,
  sleepTool,
  skillTool,
  snipTool,
  reviewArtifactTool,
  suggestPRTool,
  proactiveTool,
  advisorTool,
  mentorTool,
];

// ─── Tool Map ───────────────────────────────────────────────────

const toolMap = new Map<string, ToolDefinition>();
for (const tool of ALL_TOOLS) {
  toolMap.set(tool.name, tool);
}

// ─── Usage Tracking ────────────────────────────

interface ToolUsage {
  name: string;
  callCount: number;
  successCount: number;
  failureCount: number;
  totalMs: number;
}

const toolUsageMap = new Map<string, ToolUsage>();

// ─── Concurrency Locks ───────────────────────────────────────
// Promise-based chained semaphore for atomic async-safe locking.
// Uses a chain pattern: each caller replaces the map entry with its own
// promise BEFORE awaiting the previous one. This eliminates the race
// condition where two callers both pass the await and then both try
// to set their lock simultaneously.
const toolLocks = new Map<string, Promise<void>>();

async function acquireToolLock(lockKey: string): Promise<() => void> {
  // Atomically chain: replace the map entry with our promise FIRST,
  // then await the previous holder's promise. This guarantees that
  // the next caller will wait on US, not skip past.
  let release: () => void;
  const ourPromise = new Promise<void>(resolve => { release = resolve; });
  const previous = toolLocks.get(lockKey) || null;
  toolLocks.set(lockKey, ourPromise);  // atomic: set before await

  if (previous) {
    // Wait for the previous holder to finish before we proceed
    await previous;
  }
  return release!;
}

function getToolUsage(name: string): ToolUsage {
  let usage = toolUsageMap.get(name);
  if (!usage) {
    usage = { name, callCount: 0, successCount: 0, failureCount: 0, totalMs: 0 };
    toolUsageMap.set(name, usage);
  }
  return usage;
}

export function getToolUsageReport(): string {
  const entries = Array.from(toolUsageMap.values())
    .sort((a, b) => b.callCount - a.callCount);
  if (entries.length === 0) return '';
  return entries.map(u => {
    const avgMs = u.callCount > 0 ? Math.round(u.totalMs / u.callCount) : 0;
    const successRate = u.callCount > 0 ? Math.round((u.successCount / u.callCount) * 100) : 0;
    return `  ${u.name}: ${u.callCount}x (${successRate}% success, avg ${avgMs}ms)`;
  }).join('\n');
}

// ─── MCP Tool Integration ───────────────────────────────────────

let mcpClient: MCPClient | null = null;
// MCP tools are stored separately so they can be cleanly removed on disconnect.
// They are NOT pushed into ALL_TOOLS to prevent unbounded growth on reconnects.
const MCP_TOOLS: ToolDefinition[] = [];

export function setMCPClient(client: MCPClient | null): void {
  // If replacing or removing client, unregister old MCP tools first
  if (mcpClient) {
    unregisterMCPTools();
  }
  mcpClient = client;
}

export function registerMCPTools(client: MCPClient): void {
  const mcpTools = client.getAllTools();
  for (const mt of mcpTools) {
    const name = `mcp_${mt.serverName}_${mt.name}`.replace(/[^a-zA-Z0-9_]/g, '_');
    if (toolMap.has(name)) continue; // already registered (from a previous connection)
    const def: ToolDefinition = {
      name,
      description: `[MCP ${mt.serverName}] ${mt.description}`,
      parameters: mt.inputSchema ? {
        type: 'object' as const,
        properties: Object.fromEntries(
          Object.entries((mt.inputSchema as any).properties || {}).map(([k, v]: [string, any]) => [k, { type: v.type || 'string', description: v.description || '' }])
        ),
        required: (mt.inputSchema as any).required as string[] | undefined,
      } : undefined,
      tier: 'write',
      concurrencySafe: true,
      readOnly: false,
      destructive: false,
      execute: async (args: string, _signal?: AbortSignal): Promise<ToolResult> => {
        try {
          let parsed: Record<string, unknown>;
          try {
            parsed = args ? JSON.parse(args) : {};
          } catch {
            // Try parsing as key=value pairs
            parsed = {};
            if (args) {
              for (const part of args.split(/\s+/)) {
                const eq = part.indexOf('=');
                if (eq > 0) parsed[part.slice(0, eq)] = part.slice(eq + 1);
              }
            }
          }
          // Validate required fields from input schema
          const required = (mt.inputSchema as any)?.required as string[] | undefined;
          if (required && required.length > 0) {
            const missing = required.filter((r: string) => !(r in parsed) || parsed[r] === undefined || parsed[r] === null);
            if (missing.length > 0) {
              return { output: `Missing required fields: ${missing.join(', ')}`, success: false };
            }
          }
          const result = await client.callTool(mt.name, parsed);
          const output = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result ?? '');
          return { output, success: true };
        } catch (e: any) {
          return { output: `MCP error: ${e.message}`, success: false };
        }
      },
    };
    MCP_TOOLS.push(def);
    toolMap.set(name, def);
  }
}

/**
 * Unregister all MCP tools (called on disconnect or client replacement).
 * Removes MCP tools from the toolMap and clears MCP_TOOLS array.
 */
export function unregisterMCPTools(): void {
  for (const tool of MCP_TOOLS) {
    toolMap.delete(tool.name);
  }
  MCP_TOOLS.length = 0;
}

// ─── Registry Implementation ────────────────────────────────────

export const toolRegistry: ToolRegistry = {
  get(name: string): ToolDefinition | undefined {
    return toolMap.get(name);
  },

  getAll(): ToolDefinition[] {
    return [...ALL_TOOLS, ...MCP_TOOLS];
  },

  getNames(): string[] {
    return [...ALL_TOOLS, ...MCP_TOOLS].map(t => t.name);
  },

  getForPrompt(): string {
    return [...ALL_TOOLS, ...MCP_TOOLS].map(t => {
      const safety = t.readOnly ? ' [read-only]' : t.destructive ? ' [destructive]' : '';
      return `  ${t.name} — ${t.description}${safety}`;
    }).join('\n');
  },

  /** Search tools by name or description */
  search(query: string): ToolDefinition[] {
    const lower = query.toLowerCase();
    return [...ALL_TOOLS, ...MCP_TOOLS].filter(t =>
      t.name.toLowerCase().includes(lower) ||
      t.description.toLowerCase().includes(lower) ||
      (t.prompt && t.prompt.toLowerCase().includes(lower))
    );
  },

  /** Get tools by tier */
  getByTier(tier: 'read' | 'write' | 'exec'): ToolDefinition[] {
    return [...ALL_TOOLS, ...MCP_TOOLS].filter(t => t.tier === tier);
  },

  /** Get read-only tools */
  getReadOnly(): ToolDefinition[] {
    return [...ALL_TOOLS, ...MCP_TOOLS].filter(t => t.readOnly);
  },

  async execute(name: string, args: string, signal?: AbortSignal): Promise<ToolResult> {
    const startTime = Date.now();
    const tool = toolMap.get(name);

    if (!tool) {
      return {
        output: `Unknown tool: ${name}. Available: ${ALL_TOOLS.map(t => t.name).join(', ')}`,
        success: false,
      };
    }

    // Check abort signal before execution
    if (signal?.aborted) {
      return { output: 'Execution cancelled.', success: false };
    }

    // Check cooldown
    const remaining = checkToolCooldown(tool);
    if (remaining !== null) {
      return {
        output: `${tool.name} still on cooldown (${remaining}ms remaining)`,
        success: false,
      };
    }

    // Non-concurrent tools check — async-safe semaphore
    // Instead of immediately rejecting, we queue and wait for the lock.
    // This prevents the race condition where two concurrent calls both
    // see the lock as free and both proceed.
    let releaseLock: (() => void) | undefined;
    if (!tool.concurrencySafe) {
      const lockKey = `lock:${tool.name}`;
      releaseLock = await acquireToolLock(lockKey);
    }

    // Check permissions
    if (tool.checkPermissions) {
      const perm = tool.checkPermissions(args);
      if (!perm.allowed) {
        return { output: `Permission denied: ${perm.reason}`, success: false };
      }
    }

    // Normalize args: if the model sent JSON args (e.g. {"query":"now"}),
    // flatten them to the string format the tool expects (e.g. "now").
    // This bridges the gap between models that emit JSON tool calls and
    // Kairo's tools that take flat string args.
    let normalizedArgs = args;
    if (args && args.trim().startsWith('{')) {
      try {
        const { flattenArgs } = await import('./arg-normalize.js');
        normalizedArgs = flattenArgs(name, args);
      } catch {
        // If import fails, use raw args.
      }
    }

    // Execute
    try {
      const result = await tool.execute(normalizedArgs, signal);
      const duration = Date.now() - startTime;

      // Track usage
      const usage = getToolUsage(name);
      usage.callCount++;
      usage.totalMs += duration;
      if (result.success) usage.successCount++;
      else usage.failureCount++;

      // Record call for cooldown
      recordToolCall(tool);

      // Truncate output if maxOutputLength is set
      if (tool.maxOutputLength && result.output.length > tool.maxOutputLength) {
        return {
          ...result,
          output: result.output.slice(0, tool.maxOutputLength) + `\n... [truncated at ${tool.maxOutputLength} chars]`,
        };
      }

      return result;
    } catch (e: any) {
      const duration = Date.now() - startTime;
      const usage = getToolUsage(name);
      usage.callCount++;
      usage.totalMs += duration;
      usage.failureCount++;

      return {
        output: `${tool.name} threw: ${e.message}`,
        success: false,
        metadata: { error: e.message, duration },
      };
    } finally {
      // Release concurrency lock — just resolve the promise.
      // Do NOT delete from the map: the next queued caller already
      // replaced the map entry with their own promise (see acquireToolLock).
      // Deleting would break the chain.
      if (releaseLock) {
        releaseLock();
      }
    }
  },
};

export { extractToolCalls };
export type { ToolDefinition, ToolResult, ToolRegistry };
