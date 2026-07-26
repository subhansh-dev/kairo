/**
 * Kairo — Agent Orchestration System
 * Multi-agent workflows with task routing and parallel execution
 */

import { getRouteSync, type ModelRoute, TaskType } from '../core/router.js';
import { getRegistry, type Provider, type ChatMessage } from '../providers/registry.js';
import { toolRegistry } from '../tools/index.js';
import type { ToolResult } from '../tools/types.js';
import { trackSubagentSpawn, trackSubagentProgress, trackSubagentComplete, type SubagentStatus } from '../core/subagent-tracker.js';

// ─── Agent Definition ───────────────────────────────────────────

export interface AgentDef {
  name: string;
  description: string;
  systemPrompt: string;
  preferredTaskType?: TaskType;
  preferredModel?: string;
  /** Whether agent can use tools */
  enableTools: boolean;
  /** Max turns for this agent */
  maxTurns: number;
}

export const AGENTS: Record<string, AgentDef> = {
  planner: {
    name: 'planner',
    description: 'Creates implementation plans for complex features',
    preferredTaskType: TaskType.PLANNING,
    preferredModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    enableTools: false,
    maxTurns: 1,
    systemPrompt: `You are an expert planning specialist for software projects.
Your job is to create comprehensive, actionable implementation plans.

When given a task:
1. Analyze requirements thoroughly
2. Break down into concrete steps with file paths
3. Identify dependencies between steps
4. Estimate complexity (low/medium/high)
5. Note potential risks

Output format:
## Implementation Plan: [Task]
### Overview
[2-3 sentence summary]
### Steps
1. [Step] — [File] — [Complexity] — [Dependencies]
2. ...
### Risks
- [Risk]: [Mitigation]
### Success Criteria
- [ ] [Criterion]`,
  },

  coder: {
    name: 'coder',
    description: 'Writes and implements code',
    preferredTaskType: TaskType.CODE,
    preferredModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    enableTools: true,
    maxTurns: 10,
    systemPrompt: `You are an expert software engineer. You write clean, production-ready code.

Rules:
- Write complete, working code — no stubs or placeholders
- Include proper error handling
- Use TypeScript types throughout
- Follow existing project conventions
- Add brief comments only for complex logic
- Prefer standard library over external deps when possible
- Use tools to read existing code before modifying it`,
  },

  reviewer: {
    name: 'reviewer',
    description: 'Reviews code for bugs, security, and quality',
    preferredTaskType: TaskType.CODE,
    preferredModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    enableTools: true,
    maxTurns: 3,
    systemPrompt: `You are a senior code reviewer. Analyze code for:
- Bugs and logic errors
- Security vulnerabilities
- Performance issues
- Code style and conventions
- Missing error handling
- Edge cases

Output format:
## Code Review
### Issues Found
- [SEVERITY] [File:Line] — [Description]
### Suggestions
- [Suggestion]
### Verdict: APPROVE / REQUEST_CHANGES`,
  },

  security: {
    name: 'security',
    description: 'Security-focused code analysis',
    preferredTaskType: TaskType.SECURITY,
    preferredModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    enableTools: true,
    maxTurns: 5,
    systemPrompt: `You are a security engineer specializing in application security.
Analyze code and systems for:
- Injection vulnerabilities (SQL, XSS, command, template)
- Authentication/authorization flaws
- Secrets and credentials in code
- Unsafe deserialization
- Race conditions
- Supply chain risks

Be thorough but avoid false positives. Rate findings: CRITICAL / HIGH / MEDIUM / LOW.`,
  },

  tdd: {
    name: 'tdd',
    description: 'Test-driven development workflow',
    preferredTaskType: TaskType.CODE,
    preferredModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    enableTools: true,
    maxTurns: 10,
    systemPrompt: `You follow strict TDD: Red → Green → Refactor.

When implementing a feature:
1. Write failing tests first
2. Write minimal code to pass tests
3. Refactor while keeping tests green
4. Verify all tests pass

Use the project's existing test framework. If none exists, use vitest for TypeScript projects.`,
  },

  explore: {
    name: 'explore',
    description: 'Read-only codebase exploration',
    preferredTaskType: TaskType.GENERAL,
    preferredModel: 'groq/gpt-oss-20b',
    enableTools: true,
    maxTurns: 5,
    systemPrompt: `You are a codebase explorer. Your job is to understand code structure, find relevant files, and answer questions about how things work.

Rules:
- Only use read-only tools (read, grep, glob, ls)
- Never modify files
- Provide comprehensive summaries with file paths and line numbers
- Note key patterns, dependencies, and architectural decisions`,
  },

  'backend-architect': {
    name: 'backend-architect',
    description: 'Senior backend architect for scalable system design, databases, APIs, and cloud infrastructure',
    preferredTaskType: TaskType.CODE,
    preferredModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    enableTools: true,
    maxTurns: 10,
    systemPrompt: `You are a backend architect. You design scalable systems, databases, APIs, and cloud infrastructure.

When designing systems:
- Choose architecture based on team size, domain boundaries, and scaling needs
- Design efficient data structures and database schemas
- Implement proper error handling, retry logic, and circuit breakers
- Consider security at every layer
- Document API contracts and data flows
- Think about observability: logging, metrics, tracing`,
  },

  'devops': {
    name: 'devops',
    description: 'DevOps engineer for CI/CD, Docker, Kubernetes, and infrastructure automation',
    preferredTaskType: TaskType.CODE,
    preferredModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    enableTools: true,
    maxTurns: 8,
    systemPrompt: `You are a DevOps engineer. You build and maintain CI/CD pipelines, container orchestration, and infrastructure.

Rules:
- Write infrastructure as code (Terraform, Pulumi, CloudFormation)
- Containerize applications with Docker
- Set up CI/CD pipelines (GitHub Actions, GitLab CI, Jenkins)
- Monitor and alert on system health
- Automate repetitive tasks
- Document runbooks and procedures`,
  },

  'debugger': {
    name: 'debugger',
    description: 'Expert debugger for finding and fixing bugs systematically',
    preferredTaskType: TaskType.CODE,
    preferredModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    enableTools: true,
    maxTurns: 8,
    systemPrompt: `You are a systematic debugger. You find and fix bugs by following a process:

1. Reproduce the bug — understand the exact conditions
2. Read the error message and stack trace carefully
3. Form a hypothesis about the root cause
4. Test the hypothesis with targeted changes
5. Verify the fix works
6. Write a regression test

Never guess. Always read the code first. Trace the execution path.`,
  },

  'performance': {
    name: 'performance',
    description: 'Performance engineer for profiling, optimization, and scalability',
    preferredTaskType: TaskType.CODE,
    preferredModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    enableTools: true,
    maxTurns: 8,
    systemPrompt: `You are a performance engineer. You profile, measure, and optimize code.

Rules:
- Measure before optimizing — don't guess at bottlenecks
- Use profiling tools to find hot paths
- Focus on the biggest wins first
- Consider algorithmic complexity (O(n) vs O(n²))
- Cache expensive computations
- Optimize database queries (N+1, missing indexes)
- Benchmark before and after changes`,
  },

  'data-engineer': {
    name: 'data-engineer',
    description: 'Data engineer for ETL pipelines, data warehousing, and data quality',
    preferredTaskType: TaskType.CODE,
    preferredModel: 'nvidia/nemotron-3-ultra-550b-a55b',
    enableTools: true,
    maxTurns: 8,
    systemPrompt: `You are a data engineer. You build ETL pipelines, design data warehouses, and ensure data quality.

Rules:
- Design efficient data schemas and transformations
- Handle data validation and quality checks
- Implement incremental processing where possible
- Consider data lineage and observability
- Write idempotent, retry-safe pipelines
- Document data contracts and SLAs`,
  },
};

// ─── Workflow Definitions ───────────────────────────────────────

const WORKFLOWS: Record<string, string[]> = {
  feature: ['planner', 'tdd', 'coder', 'reviewer'],
  bugfix: ['debugger', 'coder', 'reviewer'],
  refactor: ['planner', 'coder', 'reviewer'],
  security: ['security', 'reviewer'],
  tdd: ['tdd', 'reviewer'],
  quick: ['coder'],
  plan: ['planner'],
  review: ['reviewer'],
  explore: ['explore'],
  backend: ['backend-architect', 'coder', 'reviewer'],
  devops: ['devops', 'reviewer'],
  debug: ['debugger', 'reviewer'],
  perf: ['performance', 'coder', 'reviewer'],
  data: ['data-engineer', 'reviewer'],
  fullstack: ['planner', 'backend-architect', 'coder', 'tdd', 'reviewer'],
};

// ─── Types ──────────────────────────────────────────────────────

export interface AgentRunResult {
  agent: string;
  input: string;
  output: string;
  route: ModelRoute;
  toolCalls: Array<{ name: string; args: string; result: ToolResult }>;
  turns: number;
}

export interface WorkflowResult {
  steps: AgentRunResult[];
  summary: string;
  totalTokens: number;
}

export interface RunAgentOptions {
  model?: string;
  provider?: string;
  context?: string;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  /** Override system prompt (for delegated tasks) */
  systemPrompt?: string;
  /** Restrict tools to only these names */
  allowedTools?: string[];
  /** Block these tool names from use */
  blockedTools?: string[];
}

export type AgentEvent =
  | { type: 'start'; agent: string }
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_start'; name: string; args: string }
  | { type: 'tool_end'; name: string; result: ToolResult }
  | { type: 'route'; route: ModelRoute }
  | { type: 'end'; agent: string; output: string }
  | { type: 'error'; error: string };

// ─── Agent Execution ────────────────────────────────────────────

export async function runAgent(
  agentName: string,
  task: string,
  options: RunAgentOptions = {},
  parentTrackerId?: string,
): Promise<AgentRunResult> {
  const agent = AGENTS[agentName] || AGENTS.coder;
  const registry = getRegistry();
  const onEvent = options.onEvent;

  // Track subagent spawn
  const trackerId = `agent_${agentName}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  trackSubagentSpawn(trackerId, parentTrackerId, agentName, agentName);

  onEvent?.({ type: 'start', agent: agentName });

  // Build messages — allow systemPrompt override from delegation
  const systemPrompt = options.systemPrompt || agent.systemPrompt;
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
  ];

  if (options.context) {
    messages.push({ role: 'user', content: `Context:\n${options.context}` });
  }
  messages.push({ role: 'user', content: task });

  // Route to best model
  const route: ModelRoute = options.model
    ? { taskType: agent.preferredTaskType || TaskType.GENERAL, provider: options.provider || 'nvidia', model: options.model, thinking: false, routed: false }
    : getRouteSync(task);

  onEvent?.({ type: 'route', route });

  // Resolve provider
  let provider: Provider;
  let model: string;

  const resolved = registry.resolve(`${route.provider}/${route.model}`);
  if (resolved) {
    provider = resolved.provider;
    model = resolved.model;
  } else {
    const providers = registry.getAll();
    if (providers.length === 0) throw new Error('No providers configured');
    provider = providers[0];
    model = route.model;
  }

  // Agent loop
  let fullOutput = '';
  const toolCalls: AgentRunResult['toolCalls'] = [];
  let turns = 0;

  // Build tool definitions for the API if the agent has tools enabled.
  const apiTools = agent.enableTools
    ? toolRegistry.getAll().map(t => ({
        name: t.name,
        description: t.description,
        parameters: (t.parameters || {
          type: 'object' as const,
          properties: {},
          description: t.prompt || t.description,
        }) as any,
        tier: t.tier,
        concurrencySafe: t.concurrencySafe,
      }))
    : undefined;

  for (let turn = 0; turn < agent.maxTurns; turn++) {
    turns++;

    // Stream response from model for real-time feedback
    let turnContent = '';
    const structuredToolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];

    for await (const event of provider.stream(messages, model, {
      reasoning: route.thinking ? 'high' : undefined,
      signal: options.signal,
      tools: apiTools,
      toolChoice: apiTools ? 'auto' as const : undefined,
    })) {
      if (event.type === 'text') {
        turnContent += event.text;
        onEvent?.({ type: 'text', content: event.text });
      } else if (event.type === 'thinking_delta') {
        onEvent?.({ type: 'thinking', content: event.delta });
      } else if (event.type === 'tool_call_end') {
        // Structured tool call from the API — accumulate it.
        structuredToolCalls.push({
          id: event.id,
          name: event.name,
          arguments: event.arguments,
        });
      } else if (event.type === 'error') {
        onEvent?.({ type: 'error', error: event.error });
        break;
      }
    }

    fullOutput += turnContent;

    // Check for tool calls if agent has tools enabled
    if (agent.enableTools) {
      // Use structured API tool calls first, then fall back to text-based parsing.
      const { extractToolCalls } = await import('../tools/types.js');
      const { flattenArgs } = await import('../tools/arg-normalize.js');
      const textCalls = extractToolCalls(turnContent);

      // Convert structured calls to the same format as text calls.
      const structuredAsText = structuredToolCalls.map(tc => ({
        name: tc.name,
        args: typeof tc.arguments === 'string'
          ? tc.arguments
          : flattenArgs(tc.name, JSON.stringify(tc.arguments)),
      }));

      // Merge + dedupe.
      const allCalls = [...structuredAsText, ...textCalls];
      const seenKeys = new Set<string>();
      const calls = allCalls.filter(c => {
        const key = `${c.name}:${c.args.slice(0, 200)}`;
        if (seenKeys.has(key)) return false;
        seenKeys.add(key);
        return true;
      });

      if (calls.length === 0) break; // No tools — done

      // Push assistant message WITH tool_calls if we got structured calls.
      const assistantMsg: any = { role: 'assistant', content: turnContent };
      if (structuredToolCalls.length > 0) {
        assistantMsg.tool_calls = structuredToolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.arguments),
          },
        }));
      }
      messages.push(assistantMsg);

      // Execute tools — parallelize reads, serialize writes
      let toolOutput = '';
      let agentToolCount = 0;

      const readCalls: typeof calls = [];
      const writeCalls: typeof calls = [];
      for (const call of calls) {
        // Apply tool restrictions from delegation
        if (options.allowedTools && !options.allowedTools.includes(call.name)) continue;
        if (options.blockedTools && options.blockedTools.includes(call.name)) continue;
        const tool = toolRegistry.get(call.name);
        if (tool?.concurrencySafe && tool?.readOnly) {
          readCalls.push(call);
        } else {
          writeCalls.push(call);
        }
      }

      // Fan-out read tools in parallel
      if (readCalls.length > 1) {
        for (const call of readCalls) onEvent?.({ type: 'tool_start', name: call.name, args: call.args });
        const readResults = await Promise.allSettled(
          readCalls.map(async (call) => {
            const result = await toolRegistry.execute(call.name, call.args);
            return { call, result };
          })
        );
        for (const pr of readResults) {
          if (pr.status === 'fulfilled') {
            const { call, result } = pr.value;
            toolCalls.push({ name: call.name, args: call.args, result });
            onEvent?.({ type: 'tool_end', name: call.name, result });
            toolOutput += `\n\nTool ${call.name}:\n${result.output}`;
            agentToolCount++;
          }
        }
      } else if (readCalls.length === 1) {
        writeCalls.unshift(readCalls[0]);
      }

      // Serialize write/exec tools
      for (const call of writeCalls) {
        onEvent?.({ type: 'tool_start', name: call.name, args: call.args });
        const result = await toolRegistry.execute(call.name, call.args);
        toolCalls.push({ name: call.name, args: call.args, result });
        onEvent?.({ type: 'tool_end', name: call.name, result });
        toolOutput += `\n\nTool ${call.name}:\n${result.output}`;
        agentToolCount++;
      }

      // Update subagent tracker with progress
      trackSubagentProgress(trackerId, agentToolCount);

      // Push tool results as proper tool role messages (not user messages).
      // This is required for OpenAI-compatible APIs — tool results must use
      // role='tool' with a tool_call_id matching the assistant's tool_call.
      if (structuredToolCalls.length > 0) {
        // Structured: push individual tool messages with tool_call_id.
        for (const tc of structuredToolCalls) {
          const matchingCall = calls.find(c => c.name === tc.name);
          const resultText = matchingCall
            ? (toolCalls.find(tcl => tcl.name === tc.name)?.result?.output || 'No output')
            : 'No output';
          messages.push({
            role: 'tool' as const,
            content: resultText,
            tool_call_id: tc.id,
          } as any);
        }
      } else {
        // Text-based: push as user message (legacy fallback).
        messages.push({ role: 'user', content: `Tool results:${toolOutput}` });
      }
    } else {
      break; // No tools enabled — single turn
    }
  }

  onEvent?.({ type: 'end', agent: agentName, output: fullOutput });

  // Track subagent completion
  trackSubagentComplete(trackerId, 'completed');

  return {
    agent: agentName,
    input: task,
    output: fullOutput,
    route,
    toolCalls,
    turns,
  };
}

// ─── Workflow Execution ─────────────────────────────────────────

export async function runWorkflow(
  workflowName: string,
  task: string,
  options: RunAgentOptions = {},
  parentTrackerId?: string,
): Promise<WorkflowResult> {
  const agents = WORKFLOWS[workflowName] || ['coder'];
  const steps: AgentRunResult[] = [];
  let currentContext = options.context || '';
  let totalTokens = 0;

  for (let i = 0; i < agents.length; i++) {
    const agentName = agents[i];
    const prevOutput = steps.length > 0 ? steps[steps.length - 1].output : '';
    // Truncate previous output to avoid context blowup
    const truncated = prevOutput.length > 2000 ? prevOutput.slice(0, 2000) + '\n... [truncated]' : prevOutput;
    const stepTask = i === 0
      ? task
      : `Previous output from ${agents[i - 1]}:\n${truncated}\n\nOriginal task: ${task}`;

    const result = await runAgent(agentName, stepTask, {
      ...options,
      context: currentContext,
    }, parentTrackerId);

    steps.push(result);
    currentContext = truncated;
  }

  return {
    steps,
    summary: steps[steps.length - 1]?.output || 'No output',
    totalTokens,
  };
}

// ─── Exports ────────────────────────────────────────────────────

export function getAgent(name: string): AgentDef | undefined {
  return AGENTS[name];
}

export function listAgents(): AgentDef[] {
  return Object.values(AGENTS);
}

export function getWorkflow(name: string): string[] {
  return WORKFLOWS[name] || ['coder'];
}

export function listWorkflows(): Record<string, string[]> {
  return WORKFLOWS;
}

// ─── Swarm Orchestration ─────────────────────────────────────

export interface SwarmTask {
  id: string;
  description: string;
  agent: string;
  dependencies: string[];
  priority: number;
}

export interface SwarmResult {
  taskId: string;
  agent: string;
  output: string;
  success: boolean;
  duration: number;
}

export interface SwarmPlan {
  tasks: SwarmTask[];
  maxConcurrency: number;
  estimatedDuration: number;
}

/**
 * Decompose a complex task into parallelizable subtasks.
 */
export async function decomposeTask(
  task: string,
  options: RunAgentOptions = {},
): Promise<SwarmPlan> {
  const result = await runAgent('planner',
    `Decompose this task into independent subtasks for parallel execution.
For each subtask specify:
1. Description
2. Agent (coder/reviewer/security/tdd/explore)
3. Dependencies (task indices, or none)
4. Priority (1=highest)

Task: ${task}

Respond ONLY with a JSON array:
[{"description":"...","agent":"coder","dependencies":[],"priority":1}]`,
    options,
  );

  try {
    const jsonMatch = result.output.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const tasks: SwarmTask[] = parsed.map((t: any, i: number) => ({
        id: `task_${i}`,
        description: t.description || `Subtask ${i}`,
        agent: t.agent || 'coder',
        dependencies: (t.dependencies || []).map((d: number) => `task_${d}`),
        priority: t.priority || i + 1,
      }));
      return {
        tasks,
        maxConcurrency: Math.min(tasks.length, 10),
        estimatedDuration: tasks.length * 30000,
      };
    }
  } catch {}

  return {
    tasks: [{ id: 'task_0', description: task, agent: 'coder', dependencies: [], priority: 1 }],
    maxConcurrency: 1,
    estimatedDuration: 60000,
  };
}

/**
 * Execute a swarm plan — fan-out independent tasks, pipeline dependent ones.
 */
export async function executeSwarm(
  plan: SwarmPlan,
  options: RunAgentOptions = {},
): Promise<SwarmResult[]> {
  const results: SwarmResult[] = [];
  const completed = new Set<string>();
  const sorted = [...plan.tasks].sort((a, b) => a.priority - b.priority);

  // Process tasks in waves — each wave runs all ready tasks concurrently
  while (completed.size < sorted.length) {
    // Find all tasks whose dependencies are met
    const ready = sorted.filter(t =>
      !completed.has(t.id) &&
      t.dependencies.every(d => completed.has(d))
    );

    if (ready.length === 0) break; // Deadlock or done

    // Launch entire wave concurrently (up to maxConcurrency)
    const wave = ready.slice(0, plan.maxConcurrency);
    const wavePromises = wave.map(task => {
      const depContext = task.dependencies
        .map(d => results.find(r => r.taskId === d))
        .filter(Boolean)
        .map(r => `[${r!.taskId}] ${r!.output.slice(0, 500)}`)
        .join('\n\n');

      const taskPrompt = depContext
        ? `Previous results:\n${depContext}\n\nNow: ${task.description}`
        : task.description;

      const startTime = Date.now();
      return runAgent(task.agent, taskPrompt, options, `swarm_${task.id}`)
        .then(r => ({ taskId: task.id, agent: task.agent, output: r.output, success: true, duration: Date.now() - startTime }))
        .catch(err => ({ taskId: task.id, agent: task.agent, output: `Error: ${err.message}`, success: false, duration: Date.now() - startTime }));
    });

    // Wait for entire wave to complete (true parallelism)
    const waveResults = await Promise.allSettled(wavePromises);
    for (const pr of waveResults) {
      if (pr.status === 'fulfilled') {
        results.push(pr.value);
        completed.add(pr.value.taskId);
      } else {
        // Shouldn't happen since we catch errors in the promise, but safety net
        const taskIdx = waveResults.indexOf(pr);
        const task = wave[taskIdx];
        results.push({ taskId: task.id, agent: task.agent, output: `Error: ${pr.reason}`, success: false, duration: 0 });
        completed.add(task.id);
      }
    }
  }

  return results;
}

/**
 * Full swarm: decompose → execute → synthesize
 */
export async function swarm(
  task: string,
  options: RunAgentOptions = {},
): Promise<{ plan: SwarmPlan; results: SwarmResult[]; summary: string }> {
  const plan = await decomposeTask(task, options);
  const results = await executeSwarm(plan, options);

  const summaryParts = results
    .filter(r => r.success)
    .map(r => `[${r.agent}] ${r.output.slice(0, 300)}`);

  const synthesis = await runAgent('reviewer',
    `Synthesize these results into a coherent answer.\n\nOriginal task: ${task}\n\nResults:\n${summaryParts.join('\n\n')}`,
    options,
    'swarm_synthesis',
  );

  return { plan, results, summary: synthesis.output };
}
