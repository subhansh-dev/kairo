import { analyzePrompt, selectTeam, MODELS, type ModelRoute, type TeamMember, type ComplexityLevel } from './router.js';
import { decideTurn, buildRolePrompt, parseVerdict, type CoordinatorRole, type CoordinatorDecision } from './coordinator.js';
import { getRegistry, type ChatMessage, type Provider } from '../providers/registry.js';
import { toolRegistry, extractToolCalls, registerMCPTools, setMCPClient, getToolUsageReport } from '../tools/index.js';
import type { ToolResult } from '../tools/types.js';
import type { MCPClient } from '../mcp/client.js';
import { SkillLoader } from '../skills/loader.js';
import { HookManager } from '../hooks/manager.js';
import { SessionManager } from '../session/manager.js';
import type { StreamOptions, Message, AssistantMessageEvent, Effort, ToolCall } from '../providers/types.js';
import { buildFullContext } from './context.js';
import { shouldCompact, compactMessages, DEFAULT_COMPACTION_SETTINGS } from './compaction.js';
import { trackUsage, getSessionStats, formatStats } from './cost-tracker.js';
import { recordSuccess, recordFailure, recordVerifierFeedback } from './learner.js';
import { normalizeForProvider } from '../providers/normalize.js';
import { shouldRunAutoFix, runAutoFix, buildAutoFixFeedback, type AutoFixConfig } from '../tools/auto-fix.js';
import { truncateToolResult } from '../tools/size-limits.js';
import { updateFailureLoopGuard, createFailureLoopState, resetFailureLoopGuard, type ToolFailureLoopGuardState } from '../tools/failure-loop-guard.js';
import { normalizeToolArguments } from '../tools/arg-normalize.js';
import { recordToolFailure, recordToolSuccess, getFailureSummary } from './safety.js';
import { classifyThinkingLevel } from './safety.js';
import { SecretObfuscator, collectConfigSecrets, collectEnvSecrets, obfuscateMessages } from './secrets.js';
import { sanitizeMessage } from './sanitize.js';
import { GuardrailController } from './guardrails.js';
import { checkWriteSafety, checkReadSafety } from './file-safety.js';
import { getRateLimitTracker } from './rate-limiter.js';
import { TurnBudgetManager } from './tool-results.js';
import { recordSession, generateReport } from '../curator/engine.js';
import { getCached, setCached, invalidateFile } from './result-cache.js';
import { recordActivity, detectSilentFailures, getDiagnostics } from './observability.js';
import { extractMemories, storeMemories, formatMemoriesForContext } from './memory-extract.js';
import { trackSubagentProgress, trackSubagentFileRead, trackSubagentFileWrite } from './subagent-tracker.js';
import { startSession, endSession, startTurn, endTurn, recordToolCall, recordTokens } from './agent-lifecycle.js';

export interface EngineOptions {
  model?: string;
  provider?: string;
  smol?: boolean;
  slow?: boolean;
  plan?: boolean;
  swarm?: boolean;
  workflow?: string;
  agent?: string;
  maxTurns?: number;
  projectDir?: string;
  stream?: boolean;
  signal?: AbortSignal;
  thinking?: boolean;
}

export type EngineEvent =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_start'; name: string; args: string }
  | { type: 'tool_end'; name: string; result: ToolResult }
  | { type: 'route'; route: ModelRoute }
  | { type: 'coordinator'; role: CoordinatorRole; reasoning: string }
  | { type: 'verdict'; approved: boolean; feedback: string }
  | { type: 'error'; content: string }
  | { type: 'done'; content: string; route: ModelRoute; usage?: any }
  | { type: 'provider_switch'; from: string; to: string }
  | { type: 'agent_spawn'; id: string; parentId?: string; name: string; agent: string }
  | { type: 'agent_complete'; id: string; status: 'completed' | 'failed' | 'interrupted' };

let skillLoader: SkillLoader | null = null;
let hookManager: HookManager | null = null;
let sessionManager: SessionManager | null = null;
let secretObfuscator: SecretObfuscator | null = null;

async function initSystems(projectDir?: string) {
  if (!skillLoader) skillLoader = new SkillLoader(projectDir);
  if (!hookManager) hookManager = new HookManager(projectDir);
  if (!sessionManager) sessionManager = new SessionManager();
  if (!secretObfuscator) {
    const configSecrets = collectConfigSecrets(getRegistry().getConfigs() as any);
    const envSecrets = collectEnvSecrets();
    secretObfuscator = new SecretObfuscator([...configSecrets, ...envSecrets]);
  }
  try {
    const { MCPClient: MCP } = await import('../mcp/client.js');
    const mcp = new MCP(projectDir);
    setMCPClient(mcp);
    await Promise.race([
      mcp.connectAll(),
      new Promise(resolve => setTimeout(resolve, 5_000)),
    ]);
    if (mcp.getConnectedServers().length > 0) {
      registerMCPTools(mcp);
    }
  } catch (err) {
    // MCP initialization failure is non-fatal but should be logged
    console.error('[MCP] Initialization warning:', err instanceof Error ? err.message : String(err));
  }
}

export function getSecretObfuscator(): SecretObfuscator | null {
  return secretObfuscator;
}

/** Reset all module-level singletons (for testing or re-initialization) */
export function resetEngine(): void {
  skillLoader = null;
  hookManager = null;
  sessionManager = null;
  secretObfuscator = null;
  failedProviders.clear();
}

// ─── System Prompt ──────────────────────────────────────────────

function buildSystemPrompt(skills: SkillLoader, projectDir?: string): string {
  // Load master system prompt from skills (always-apply)
  let base = '';

  // Soul.md is the identity layer — inject at the very top of the system prompt
  // so it's never compacted out and always shapes behavior
  const soul = skills.find('soul');
  if (soul) {
    base += soul.content + '\n\n';
  }

  const masterPrompt = skills.find('kairo-system-prompt');
  if (masterPrompt) {
    base += masterPrompt.content;
  } else {
    base += `You are Kairo, a coding agent. Use tools to solve problems. Don't describe what you would do — do it.`;
  }

  // NOTE: Tool schemas are now sent via the native function-calling API
  // (streamOptions.tools). We do NOT add a text tool list to the system
  // prompt — that would confuse the model with conflicting formats.

  const skillSection = skills.renderForPrompt();
  const context = buildFullContext(projectDir);
  const contextSection = context.combined ? `\n\n${context.combined}` : '';

  return base + skillSection + contextSection;
}

// ─── Provider Resolution with Failover Tracking ────────────────

interface ResolvedProvider {
  provider: Provider;
  model: string;
  route: ModelRoute;
}

const failedProviders = new Map<string, number>(); // provider:model → epoch

function markProviderFailed(key: string) {
  failedProviders.set(key, Date.now());
  // Cap at 50 entries to prevent unbounded growth
  if (failedProviders.size > 50) {
    const now = Date.now();
    for (const [k, epoch] of failedProviders) {
      if (now - epoch > 120_000) failedProviders.delete(k); // clean entries older than 2min
    }
    // If still over cap, remove oldest entries
    if (failedProviders.size > 50) {
      const sorted = [...failedProviders.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < sorted.length - 50; i++) {
        failedProviders.delete(sorted[i][0]);
      }
    }
  }
}

function isProviderFailed(key: string): boolean {
  const epoch = failedProviders.get(key);
  if (!epoch) return false;
  // Reset after 60 seconds
  if (Date.now() - epoch > 60_000) {
    failedProviders.delete(key);
    return false;
  }
  return true;
}

function resolveProvider(route: ModelRoute, options: EngineOptions): ResolvedProvider | null {
  const registry = getRegistry();

  if (options.model) {
    // Handle model passed with provider prefix (e.g., "groq/gpt-oss-120b")
    let modelName = options.model;
    let providerName = options.provider || route.provider;
    
    if (options.model.includes('/')) {
      const parts = options.model.split('/');
      providerName = parts[0];
      modelName = parts.slice(1).join('/');
    }
    
    const resolved = registry.resolve(`${providerName}/${modelName}`);
    if (resolved) return { ...resolved, route: { ...route, provider: providerName, model: modelName } };
    const found = registry.findModel(modelName);
    if (found) return { ...found, route: { ...route, provider: found.provider.name, model: found.model } };
  }

  const resolved = registry.resolve(`${route.provider}/${route.model}`);
  if (resolved && resolved.provider.models.includes(route.model)) return { ...resolved, route };

  const found = registry.findModel(route.model);
  if (found) return { ...found, route: { ...route, provider: found.provider.name, model: found.model } };

  return null;
}

function* getFailoverProviders(route: ModelRoute, exclude?: string): Generator<ResolvedProvider> {
  const registry = getRegistry();
  const all = registry.getAll();

  const primary = registry.resolve(`${route.provider}/${route.model}`);
  if (primary && primary.provider.name !== exclude && !isProviderFailed(`${primary.provider.name}:${route.model}`)) {
    yield { ...primary, route };
  }

  for (const p of all) {
    if (p.name === exclude || p.name === route.provider) continue;
    if (isProviderFailed(`${p.name}:${route.model}`)) continue;
    yield { provider: p, model: route.model, route: { ...route, provider: p.name } };
  }

  for (const p of all) {
    if (p.name === exclude) continue;
    const key = `${p.name}:${p.models[0]}`;
    if (isProviderFailed(key)) continue;
    const model = p.models[0] || 'gpt-oss-20b';
    yield { provider: p, model, route: { ...route, provider: p.name, model } };
  }
}

// ─── Streaming Chat with Exponential Backoff ───────────────────

async function* streamWithRetry(
  provider: Provider,
  messages: Message[],
  model: string,
  options: StreamOptions,
  maxRetries = 2,
): AsyncGenerator<AssistantMessageEvent> {
  let lastErr: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      yield* provider.stream(messages, model, options);
      return;
    } catch (err: any) {
      lastErr = err;
      if (err.name === 'AbortError') throw err;

      const statusCode = parseInt(err.message?.match?.(/\d{3}/)?.[0] || '0');

      // 429 (rate limit) → failover immediately, don't retry on same provider
      if (statusCode === 429) {
        throw err;
      }

      // 5xx or timeout → retry with backoff
      const isRetryable = statusCode >= 500 || err.message?.includes('timeout');
      if (isRetryable && attempt < maxRetries) {
        const backoff = 1000 * Math.pow(2, attempt);
        // Yield informational event — NOT terminal.  The caller should
        // NOT failover on retryable errors; this generator will retry.
        yield { type: 'error' as const, error: `Retry ${attempt + 1}/${maxRetries} after ${backoff}ms: ${err.message}`, retryable: true as const };
        await new Promise(ok => setTimeout(ok, backoff));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ─── Structured Tool Call Handler ───────────────────────────────

function formatToolCallArgs(call: ToolCall): string {
  const args = call.arguments;
  if (!args) return '';
  if (typeof args === 'string') return args;

  // args is a Record<string, unknown> from the API.
  // Convert to the flat string format the tools expect.
  try {
    const argsStr = JSON.stringify(args);
    const a = args as any;

    // Special-case tools that take command-style args.
    if (call.name === 'todo') {
      const action = String(a.action || a.command || '');
      const text = String(a.text || a.task || a.content || '');
      return action ? (text ? `${action} ${text}` : action) : argsStr;
    }
    if (call.name === 'grep') {
      const pattern = String(a.pattern || a.query || a.regex || '');
      const path = String(a.path || a.file || a.glob || '');
      return path ? `${pattern} ${path}` : pattern;
    }
    if (call.name === 'glob') {
      const pattern = String(a.pattern || a.glob || '');
      const path = String(a.path || a.dir || '');
      return path ? `${pattern} ${path}` : pattern;
    }
    if (call.name === 'ls') {
      const path = String(a.path || a.dir || a.directory || '');
      const depth = a.depth !== undefined ? `--depth ${a.depth}` : '';
      return [path, depth].filter(Boolean).join(' ');
    }
    if (call.name === 'skill') {
      const name = String(a.name || a.skill || '');
      const query = String(a.query || a.input || '');
      return name ? (query ? `${name} ${query}` : name) : argsStr;
    }
    if (call.name === 'agent') {
      const agentName = String(a.agentName || a.agent || a.name || '');
      const task = String(a.task || a.prompt || a.input || '');
      return agentName ? (task ? `${agentName} ${task}` : agentName) : argsStr;
    }

    // Multi-arg tools with specific formats.
    if (call.name === 'exec' || call.name === 'bash') {
      return String(a.command || a.cmd || a.shell || argsStr);
    }
    if (call.name === 'write' || call.name === 'file_write') {
      const path = String(a.path || a.file || a.filename || '');
      const content = String(a.content || a.text || a.data || '');
      return `${path}\n${content}`;
    }
    if (call.name === 'read' || call.name === 'file_read') {
      const path = String(a.path || a.file || '');
      const offset = a.offset !== undefined ? ` ${a.offset}` : '';
      const limit = a.limit !== undefined ? ` ${a.limit}` : '';
      return `${path}${offset}${limit}`;
    }
    if (call.name === 'edit' || call.name === 'file_edit') {
      const path = String(a.path || a.file || '');
      const oldStr = String(a.old_string || a.old || a.find || a.search || '');
      const newStr = String(a.new_string || a.new || a.replace || '');
      return `${path}\n${oldStr}\n${newStr}`;
    }
    if (call.name === 'web_fetch') {
      const url = String(a.url || a.uri || a.link || '');
      const prompt = String(a.prompt || a.question || '');
      return prompt ? `${url} ${prompt}` : url;
    }
    if (call.name === 'web_search') {
      return String(a.query || a.q || a.search || argsStr);
    }
    if (call.name === 'memory') {
      const action = String(a.action || a.command || 'save');
      const key = String(a.key || '');
      const value = String(a.value || a.content || '');
      return `${action} ${key} ${value}`;
    }

    // Generic: extract the primary field.
    const primaryFields = ['query', 'path', 'command', 'content', 'url', 'name', 'prompt', 'text', 'pattern', 'input', 'action'];
    for (const field of primaryFields) {
      if (a[field] !== undefined) {
        return String(a[field]);
      }
    }
    return argsStr;
  } catch {
    return JSON.stringify(args);
  }
}

// ─── Agent Loop ─────────────────────────────────────────────────

export async function* agentLoop(
  input: string,
  history: ChatMessage[],
  options: EngineOptions = {},
): AsyncGenerator<EngineEvent> {
  await initSystems(options.projectDir);

  if (!skillLoader || !hookManager || !sessionManager) {
    yield { type: 'error', content: 'Failed to initialize core systems.' };
    return;
  }

  // ── Swarm mode: decompose → parallel agents → synthesize ──────
  if (options.swarm) {
    yield { type: 'thinking', content: '[Swarm mode: decomposing task into parallel agents]' };
    try {
      const { swarm } = await import('../agents/orchestrator.js');
      const pendingEvents: EngineEvent[] = [];
      const result = await swarm(input, {
        model: options.model,
        provider: options.provider,
        signal: options.signal,
        onEvent: (event: any) => {
          if (event.type === 'text') pendingEvents.push({ type: 'text', content: event.content });
          if (event.type === 'tool_start') pendingEvents.push({ type: 'tool_start', name: event.name, args: event.args });
          if (event.type === 'tool_end') pendingEvents.push({ type: 'tool_end', name: event.name, result: event.result });
          if (event.type === 'thinking') pendingEvents.push({ type: 'thinking', content: event.content });
          if (event.type === 'error') pendingEvents.push({ type: 'error', content: event.error });
        },
      });
      // Yield collected events
      for (const evt of pendingEvents) yield evt;
      yield { type: 'thinking', content: `[Swarm: ${result.results.length} agents completed]` };
      yield { type: 'text', content: result.summary };
      yield {
        type: 'done',
        content: result.summary,
        route: { taskType: 'general' as any, provider: options.provider || 'nvidia', model: options.model || 'swarm', thinking: false, routed: true },
      };
    } catch (err: any) {
      yield { type: 'error', content: `Swarm error: ${err.message}` };
    }
    return;
  }

  let route: ModelRoute;
  let team: TeamMember[] = [];
  let complexity: ComplexityLevel = 'simple';
  let verifyRun = false;
  const modelFailures: Record<string, number> = {};
  const failureLoopState: ToolFailureLoopGuardState = createFailureLoopState();

  if (options.model) {
    route = {
      taskType: 'general' as any,
      provider: options.provider || 'nvidia',
      model: options.model,
      thinking: options.thinking || false,
      routed: false,
    };
    team = [{ provider: route.provider, model: route.model, thinking: route.thinking, role: 'worker' }];
  } else if (options.smol) {
    route = { taskType: 'quick' as any, ...MODELS.fast, routed: true };
    team = [{ ...MODELS.fast, role: 'fast' }];
  } else if (options.slow || options.plan) {
    route = { taskType: 'planning' as any, ...MODELS.thinker, routed: false };
    team = [{ ...MODELS.thinker, role: 'thinker' }];
  } else {
    const profile = await analyzePrompt(input);
    complexity = profile.complexity;
    const modelTeam = selectTeam(profile);
    team = modelTeam.members;
    route = { ...modelTeam.primary };
    verifyRun = modelTeam.verify;
  }

  yield { type: 'route', route };

  const guardrails = new GuardrailController();
  const turnBudget = new TurnBudgetManager();

  const systemPrompt = buildSystemPrompt(skillLoader!, options.projectDir);
  // alwaysApply skills — but exclude soul since it's already in the system prompt
  const alwaysApply = skillLoader!.getAlwaysApply().filter(s => s.name !== 'soul');
  let contextPrefix = '';
  if (alwaysApply.length > 0) {
    contextPrefix = '\n\nRelevant skills:\n' + alwaysApply.map(s => `### ${s.name}\n${s.content}`).join('\n\n');
  }

  // Inject relevant memories
  const memoryContext = formatMemoriesForContext(input, 5);
  if (memoryContext) contextPrefix += memoryContext;

  let workingHistory = history;
  if (shouldCompact(history, 128000)) {
    const compacted = compactMessages(history);
    workingHistory = compacted.messages;
    yield { type: 'thinking', content: `[Context compacted: ${compacted.tokensBefore} → ${compacted.tokensAfter} tokens via ${compacted.strategy}]` };
  }

  let thinkingEffort: Effort | undefined;
  if (!options.thinking && !options.slow && !options.smol) {
    const thinkingLevel = classifyThinkingLevel(input);
    if (thinkingLevel !== 'off' && thinkingLevel !== 'minimal') {
      route.thinking = true;
      thinkingEffort = thinkingLevel === 'xhigh' ? 'xhigh' as Effort
        : thinkingLevel === 'high' ? 'high' as Effort
        : thinkingLevel === 'medium' ? 'medium' as Effort
        : 'low' as Effort;
    }
  }

  const messages: Message[] = [
    { role: 'system', content: systemPrompt + contextPrefix },
    ...workingHistory.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: input },
  ];

  // Note: message sanitization happens at the point of use (when building turnMessages)
  // to ensure all messages including loop-appended ones are sanitized before LLM calls.

  await hookManager!.runSessionStart();

  // Start lifecycle session tracking
  startSession();

  let resolved = null;
  for (const member of team) {
    resolved = resolveProvider({
      taskType: route.taskType, provider: member.provider, model: member.model,
      thinking: member.thinking, routed: true,
    }, options);
    if (resolved) { route = { ...route, provider: member.provider, model: member.model, thinking: member.thinking }; break; }
  }
  if (!resolved) {
    const all = getRegistry().getAll();
    const preferFast = complexity === 'simple' || complexity === 'medium';
    for (const p of all) {
      const candidates = preferFast ? [...p.models].reverse() : p.models;
      for (const m of candidates) {
        const testRoute = resolveProvider({ taskType: route.taskType, provider: p.name, model: m, thinking: false, routed: true }, options);
        if (testRoute) { resolved = testRoute; route = { ...route, provider: p.name, model: m }; break; }
      }
      if (resolved) break;
    }
  }
  if (!resolved) {
    yield { type: 'error', content: 'No providers configured. Set API keys in ~/.kairo/models.yml' };
    return;
  }

  let { provider, model } = resolved;
  const maxTurns = options.maxTurns || 10;
  let fullContent = '';
  let allToolCalls: Array<{ name: string; args: string }> = [];
  let hadToolFailure = false;
  let coordinatorRole: CoordinatorRole = 'worker';
  let verifierIteration = 0;
  let verifierFeedback = '';
  const maxVerifierIterations = 3;
  // Repetition loop guard: track recent turn texts to detect when the
  // model is stuck generating the same output over and over.
  const recentTurnTexts: string[] = [];
  const MAX_REPEATED_TURNS = 3;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (options.signal?.aborted) {
      yield { type: 'error', content: 'Cancelled.' };
      return;
    }

    // ── Coordinator: decide which role + model for this turn ────
    const decision = decideTurn({
      turn,
      taskType: route.taskType,
      complexity,
      hasToolOutput: allToolCalls.length > 0,
      lastTurnRole: coordinatorRole as CoordinatorRole,
      lastTurnText: undefined,
      modelFailures,
      verifyRun,
      verifierIteration,
      maxVerifierIterations,
    });

    coordinatorRole = decision.role;

    // Switch provider/model if coordinator chose a different model
    if (provider.name !== decision.provider || model !== decision.model) {
      const newResolved = resolveProvider({
        taskType: route.taskType,
        provider: decision.provider,
        model: decision.model,
        thinking: decision.thinking,
        routed: true,
      }, options);
      if (newResolved && (newResolved.provider.name !== provider.name || newResolved.model !== model)) {
        yield { type: 'provider_switch', from: provider.name, to: newResolved.provider.name };
        provider = newResolved.provider;
        model = newResolved.model;
        route = { ...route, provider: newResolved.provider.name, model: newResolved.model, thinking: decision.thinking };
      }
    }

    yield { type: 'coordinator', role: coordinatorRole, reasoning: decision.reasoning };

    // Track turn in lifecycle
    startTurn('main', coordinatorRole, model, provider.name);
    const turnStartTime = Date.now();

    // ── Inject role-specific instruction ────────────────────────
    const roleInstruction = buildRolePrompt(coordinatorRole, coordinatorRole === 'verifier' ? verifierIteration : undefined);

    // For verifier: inject verifier instruction, stream, then parse verdict
    // For thinker/worker: inject role instruction + stream normally
    let turnText = '';
    let toolCallDisplayBuffer = '';  // buffers <tool_call> blocks across stream chunks
    const pendingToolCalls: ToolCall[] = [];

    // Build tool definitions for the API. Convert Kairo's ToolDefinition
    // format to the provider's Tool format so the model can use native
    // tool calling instead of emitting text-based tool calls.
    const apiTools = toolRegistry.getAll().map(t => ({
      name: t.name,
      description: t.description,
      parameters: (t.parameters || {
        type: 'object',
        properties: {},
        description: t.prompt || t.description,
      }) as any,
      tier: t.tier,
      concurrencySafe: t.concurrencySafe,
    }));

    const streamOptions: StreamOptions = {
      signal: options.signal,
      // Only send thinking/reasoning for NVIDIA (Nemotron supports it).
      // Groq/Cerebras reject the 'thinking' field with 400 errors.
      reasoning: (provider.name === 'nvidia' && (thinkingEffort ?? (route.thinking ? 'high' as Effort : undefined))) || undefined,
      tools: apiTools,
      toolChoice: 'auto' as const,
    };

    // Build messages for this turn — inject role instruction + verifier feedback
    // Sanitize all messages before sending to LLM (obfuscate secrets + sanitize content)
    const cleanBody = secretObfuscator?.hasSecrets()
      ? obfuscateMessages(secretObfuscator, messages.slice(1))
      : messages.slice(1);
    const sanitizedBody = cleanBody.map(m => ({
      ...m,
      content: typeof m.content === 'string' ? sanitizeMessage(m.content) : m.content,
    }));
    const turnMessages: Message[] = [
      { role: 'system', content: systemPrompt + contextPrefix + '\n\n## Current Role\n' + roleInstruction },
      ...sanitizedBody,
    ];

    // Inject verifier feedback if this is a re-work turn
    if (coordinatorRole === 'worker' && verifierFeedback) {
      turnMessages.push({
        role: 'user',
        content: `The verifier previously rejected the work with this feedback:\n\n${verifierFeedback}\n\nPlease address these issues in your response.`,
      });
    }

    try {
      const backoff = getRateLimitTracker().getBackoff(provider.name);
      if (backoff > 0) {
        yield { type: 'thinking', content: `[Rate limited — waiting ${backoff}ms]` };
        await new Promise(ok => setTimeout(ok, backoff));
      }
      getRateLimitTracker().recordRequest(provider.name);

      // Normalize messages for provider quirks (strip thinking blocks for Cerebras/Groq)
      const normalizedMessages = normalizeForProvider(turnMessages, provider.name);

      for await (const event of streamWithRetry(provider, normalizedMessages, model, streamOptions)) {
        switch (event.type) {
          case 'text':
            turnText += event.text;
            fullContent += event.text;
            // Strip tool-call-shaped text from the display so the user
            // doesn't see raw JSON/XML. The full text is still accumulated
            // in turnText for extractToolCalls to parse after the stream ends.
            {
              let displayText = event.text;
              const combined = toolCallDisplayBuffer + displayText;

              // 1. Strip <tool_call>...</tool_call> XML blocks (handles
              //    blocks that span multiple stream chunks).
              let cleaned = combined;
              const openIdx = combined.indexOf('<tool_call>');
              if (openIdx !== -1) {
                const closeIdx = combined.indexOf('</tool_call>', openIdx);
                if (closeIdx !== -1) {
                  cleaned = combined.slice(0, openIdx) + combined.slice(closeIdx + '</tool_call>'.length);
                  toolCallDisplayBuffer = '';
                } else {
                  cleaned = combined.slice(0, openIdx);
                  toolCallDisplayBuffer = combined.slice(openIdx);
                }
              } else {
                toolCallDisplayBuffer = '';
              }

              // 2. Strip bare JSON tool-call objects like
              //    {"tool": "web_search", "args": {...}}
              //    {"name": "read_file", "arguments": {...}}
              // These are emitted by models (Nemotron, etc.) that don't
              // use XML wrapping or the native API. We use the same
              // brace-matching logic as extractToolCalls to handle
              // nested objects in the arguments field.
              cleaned = cleaned.replace(
                /\{[^{}]*"(?:tool|name)"\s*:\s*"[a-zA-Z_][a-zA-Z0-9_-]*"[\s\S]*?\}/g,
                (match) => {
                  // Verify this is actually a parseable JSON tool call
                  // (not just random text that happens to match).
                  try {
                    const parsed = JSON.parse(match);
                    if (parsed && (parsed.tool || parsed.name)) {
                      return '';  // strip it
                    }
                  } catch {
                    // Not valid JSON — leave it.
                  }
                  return match;
                },
              );

              displayText = cleaned;
              if (displayText.trim()) {
                yield { type: 'text', content: displayText };
              }
            }
            break;

          case 'thinking_delta':
            yield { type: 'thinking', content: event.delta };
            break;

          case 'tool_call_start':
          case 'tool_call_delta':
            break;

          case 'tool_call_end':
            pendingToolCalls.push({ id: event.id, name: event.name, arguments: event.arguments });
            break;

          case 'usage':
            trackUsage(model, provider.name, event.usage);
            break;

          case 'error':
            // Skip failover on retryable errors — streamWithRetry will retry internally
            if (event.retryable) {
              yield { type: 'thinking', content: `[Provider ${provider.name} retrying...]` };
              break;
            }
            markProviderFailed(`${provider.name}:${model}`);
            let recovered = false;
            for (const fb of getFailoverProviders(route, provider.name)) {
              // Verify the failover provider is actually reachable before claiming recovery
              if (!fb.provider.models.includes(fb.model)) continue;
              yield { type: 'provider_switch', from: provider.name, to: fb.provider.name };
              provider = fb.provider;
              model = fb.model;
              route = fb.route;
              recovered = true;
              break;
            }
            if (!recovered) {
              yield { type: 'error', content: event.error };
              return;
            }
            turnText = '';
            toolCallDisplayBuffer = '';  // reset buffer for the retry
            break;

          case 'done':
            break;
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        yield { type: 'error', content: 'Cancelled.' };
        return;
      }
      markProviderFailed(`${provider.name}:${model}`);
      let recovered = false;
      for (const fb of getFailoverProviders(route, provider.name)) {
        // Verify the failover provider is actually reachable before claiming recovery
        if (!fb.provider.models.includes(fb.model)) continue;
        yield { type: 'provider_switch', from: provider.name, to: fb.provider.name };
        provider = fb.provider;
        model = fb.model;
        route = fb.route;
        recovered = true;
        break;
      }
      if (!recovered) {
        yield { type: 'error', content: err.message };
        return;
      }
      continue;
    }

    // ── Verifier: parse verdict ────────────────────────────────
    if (coordinatorRole === 'verifier') {
      const verdict = parseVerdict(turnText);
      yield { type: 'verdict', approved: verdict.approved, feedback: verdict.feedback };

      if (verdict.approved) {
        yield { type: 'thinking', content: '[Verifier approved — work is good]' };
        recordVerifierFeedback(route.taskType, provider.name, model, true);
        messages.push({ role: 'assistant', content: turnText });
        // Continue to next turn (don't break — let the agent loop continue naturally)
        continue;
      } else {
        verifierIteration++;
        verifierFeedback = verdict.feedback;
        recordVerifierFeedback(route.taskType, provider.name, model, false);
        yield { type: 'thinking', content: `[Verifier rejected — iteration ${verifierIteration}/${maxVerifierIterations}: ${verdict.feedback.slice(0, 200)}]` };

        if (verifierIteration >= maxVerifierIterations) {
          yield { type: 'error', content: `Verifier rejected after ${maxVerifierIterations} iterations: ${verdict.feedback}` };
          return;
        }

        // Don't push verifier output to messages — instead loop back to worker
        continue;
      }
    }

    // ── Non-verifier turn: collect tool calls ──────────────────
    const textToolCalls = extractToolCalls(turnText);

    // ── Repetition loop guard ──────────────────────────────────
    // If the model generates the same text 3 turns in a row with no
    // tool calls being parsed, it's stuck in a loop. Stop and tell
    // the user instead of spamming forever.
    recentTurnTexts.push(turnText.slice(0, 500));  // track first 500 chars
    if (recentTurnTexts.length > MAX_REPEATED_TURNS) {
      recentTurnTexts.shift();
    }
    if (textToolCalls.length === 0 && pendingToolCalls.length === 0 && recentTurnTexts.length >= MAX_REPEATED_TURNS) {
      // Check if all recent texts are the same (or very similar).
      const allSame = recentTurnTexts.every(t => t === recentTurnTexts[0]);
      if (allSame) {
        yield { type: 'text', content: '\n\n[Repetition detected — stopping to prevent infinite loop. The model kept generating the same output without executing tools.]' };
        yield { type: 'error', content: 'Repetition loop detected: model generated identical output ' + MAX_REPEATED_TURNS + ' times without executing any tools.' };
        endTurn('repetition_loop');
        return;
      }
    }
    
    // Deduplicate: merge structured API calls and text-based calls,
    // removing duplicates where the same tool+args appear in both sources.
    const structuredCalls = pendingToolCalls.map(tc => ({ name: tc.name, args: formatToolCallArgs(tc) }));
    const seenCallKeys = new Set<string>();
    const dedupedStructured = structuredCalls.filter(tc => {
      const key = `${tc.name}:${tc.args.slice(0, 200)}`;
      if (seenCallKeys.has(key)) return false;
      seenCallKeys.add(key);
      return true;
    });
    const dedupedText = textToolCalls.filter(tc => {
      const key = `${tc.name}:${tc.args.slice(0, 200)}`;
      if (seenCallKeys.has(key)) return false;
      seenCallKeys.add(key);
      return true;
    });
    
    const turnToolCalls = [...dedupedStructured, ...dedupedText];
    allToolCalls.push(...turnToolCalls);

    // ── Prevent tool call spam: cap total calls per turn ────────
    // Models can sometimes emit dozens of tool calls in one response,
    // which floods the system. We cap at a reasonable limit.
    const MAX_TOOL_CALLS_PER_TURN = 20;
    if (turnToolCalls.length > MAX_TOOL_CALLS_PER_TURN) {
      const excess = turnToolCalls.length - MAX_TOOL_CALLS_PER_TURN;
      yield { type: 'thinking', content: `[Anti-spam: capped tool calls from ${turnToolCalls.length} to ${MAX_TOOL_CALLS_PER_TURN} (${excess} excess calls dropped)]` };
      turnToolCalls.splice(MAX_TOOL_CALLS_PER_TURN);
    }

    if (turnToolCalls.length === 0) {
      // Text-only turn with no tools — push to history and continue
      endTurn('completed');
      messages.push({ role: 'assistant', content: turnText });
      continue;
    }

    // Push the assistant message WITH tool_calls so the API knows what
    // tool calls were made. This is required for OpenAI-compatible APIs —
    // the assistant message must include the tool_calls array, and each
    // tool result message must reference the corresponding tool_call_id.
    const assistantMsg: any = { role: 'assistant', content: turnText };
    if (pendingToolCalls.length > 0) {
      assistantMsg.tool_calls = pendingToolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        },
      }));
    }
    messages.push(assistantMsg);
    // Use a structured Map for tool results instead of string concatenation + regex
    const toolResultMap = new Map<string, string>();

    // ── Parallel tool execution ────────────────────────────────
    // Separate tools into: safe to parallelize (reads) and must serialize (writes/exec)
    const readTools: typeof turnToolCalls = [];
    const writeTools: typeof turnToolCalls = [];
    for (const tc of turnToolCalls) {
      const tool = toolRegistry.get(tc.name);
      if (tool?.concurrencySafe && tool?.readOnly) {
        readTools.push(tc);
      } else {
        writeTools.push(tc);
      }
    }

    // Execute read tools in parallel (fan-out), but cap at MAX_PARALLEL_READS
    // to prevent flooding the filesystem/network with too many concurrent calls
    const MAX_PARALLEL_READS = 6;
    // Overflow reads that exceeded the parallel cap — executed sequentially after the batch
    const overflowReads: typeof turnToolCalls = [];

    if (readTools.length > 1) {
      const batchCount = Math.min(readTools.length, MAX_PARALLEL_READS);
      yield { type: 'thinking', content: `[Parallel: ${batchCount} concurrent reads (${readTools.length} total, capped at ${MAX_PARALLEL_READS})]` };
      
      // If too many, batch them — run in chunks of MAX_PARALLEL_READS
      if (readTools.length > MAX_PARALLEL_READS) {
        // Run first batch in parallel, rest sequentially to prevent spam
        const parallelBatch = readTools.slice(0, MAX_PARALLEL_READS);
        overflowReads.push(...readTools.slice(MAX_PARALLEL_READS));
        
        for (const tc of parallelBatch) {
          yield { type: 'tool_start', name: tc.name, args: tc.args };
        }
        
        const parallelResults = await Promise.allSettled(
          parallelBatch.map(async (tc) => {
            if (tc.name === 'read') {
              const pathMatch = tc.args.match(/^(\S+)/);
              const filePath = pathMatch ? pathMatch[1] : tc.args;
              const safety = checkReadSafety(filePath);
              if (!safety.allowed) {
                return { tc, result: { output: `Safety blocked: ${safety.reason}`, success: false } as ToolResult };
              }
            }
            const rawResult = await toolRegistry.execute(tc.name, tc.args);
            const result = secretObfuscator?.hasSecrets()
              ? { ...rawResult, output: secretObfuscator.obfuscate(rawResult.output) }
              : rawResult;
            result.output = truncateToolResult(result.output);
            return { tc, result };
          })
        );
        
        for (const pr of parallelResults) {
          if (pr.status === 'fulfilled') {
            const { tc, result } = pr.value;
            yield { type: 'tool_end', name: tc.name, result };
            toolResultMap.set(tc.name, result.output);
            turnBudget.addResult(tc.name, result.output.slice(0, 10000));
            if (result.success) recordToolSuccess(tc.name);
          } else {
            const failedIdx = pr.reason ? 0 : 0;
            const failedName = parallelBatch[failedIdx]?.name || 'unknown';
            toolResultMap.set(failedName, `Parallel error: ${pr.reason}`);
          }
        }
      } else {
        // Normal parallel execution (within cap)
        for (const tc of readTools) {
          yield { type: 'tool_start', name: tc.name, args: tc.args };
        }

        const parallelResults = await Promise.allSettled(
          readTools.map(async (tc) => {
            // Safety check
            if (tc.name === 'read') {
              const pathMatch = tc.args.match(/^(\S+)/);
              const filePath = pathMatch ? pathMatch[1] : tc.args;
              const safety = checkReadSafety(filePath);
              if (!safety.allowed) {
                return { tc, result: { output: `Safety blocked: ${safety.reason}`, success: false } as ToolResult };
              }
            }

            const rawResult = await toolRegistry.execute(tc.name, tc.args);
            const result = secretObfuscator?.hasSecrets()
              ? { ...rawResult, output: secretObfuscator.obfuscate(rawResult.output) }
              : rawResult;
            result.output = truncateToolResult(result.output);
            return { tc, result };
          })
        );

        for (const pr of parallelResults) {
          if (pr.status === 'fulfilled') {
            const { tc, result } = pr.value;
            yield { type: 'tool_end', name: tc.name, result };
            toolResultMap.set(tc.name, result.output);
            turnBudget.addResult(tc.name, result.output.slice(0, 10000));
            if (result.success) recordToolSuccess(tc.name);
          } else {
            const failedIdx = 0;
            const failedName = readTools[failedIdx]?.name || 'unknown';
            toolResultMap.set(failedName, `Parallel error: ${pr.reason}`);
          }
        }
      }
    } else if (readTools.length === 1) {
      // Single read tool — safe to run in parallel with writes, but for simplicity
      // just push it to sequential execution with read safety checks
      overflowReads.push(readTools[0]);
    }

    // ── Execute overflow reads sequentially (with read safety checks only) ──
    for (const tc of overflowReads) {
      if (options.signal?.aborted) {
        endTurn('failed');
        yield { type: 'error', content: 'Cancelled.' };
        return;
      }

      yield { type: 'tool_start', name: tc.name, args: tc.args };

      // Read safety check (not write safety — these are read tools)
      if (tc.name === 'read') {
        const pathMatch = tc.args.match(/^(\S+)/);
        const filePath = pathMatch ? pathMatch[1] : tc.args;
        const safety = checkReadSafety(filePath);
        if (!safety.allowed) {
          const result: ToolResult = { output: `Safety blocked: ${safety.reason}`, success: false };
          yield { type: 'tool_end', name: tc.name, result };
          toolResultMap.set(tc.name, `Blocked: ${safety.reason}`);
          continue;
        }
      }

      const rawResult = await toolRegistry.execute(tc.name, tc.args);
      const result = secretObfuscator?.hasSecrets()
        ? { ...rawResult, output: secretObfuscator.obfuscate(rawResult.output) }
        : rawResult;
      result.output = truncateToolResult(result.output);

      yield { type: 'tool_end', name: tc.name, result };
      toolResultMap.set(tc.name, result.output);
      turnBudget.addResult(tc.name, result.output.slice(0, 10000));
      if (result.success) recordToolSuccess(tc.name);
      else hadToolFailure = true;
    }

    // Execute write/exec tools sequentially
    for (const tc of writeTools) {
      if (options.signal?.aborted) {
        endTurn('failed');
        yield { type: 'error', content: 'Cancelled.' };
        return;
      }

      yield { type: 'tool_start', name: tc.name, args: tc.args };

      if (tc.name === 'write') {
        const pathMatch = tc.args.match(/^(\S+)/);
        const filePath = pathMatch ? pathMatch[1] : tc.args;
        const safety = checkWriteSafety(filePath);
        if (!safety.allowed) {
          const result: ToolResult = { output: `Safety blocked: ${safety.reason}`, success: false };
          yield { type: 'tool_end', name: tc.name, result };
          toolResultMap.set(tc.name, `Blocked: ${safety.reason}`);
          continue;
        }
      }
      if (tc.name === 'read') {
        const pathMatch = tc.args.match(/^(\S+)/);
        const filePath = pathMatch ? pathMatch[1] : tc.args;
        const safety = checkReadSafety(filePath);
        if (!safety.allowed) {
          const result: ToolResult = { output: `Safety blocked: ${safety.reason}`, success: false };
          yield { type: 'tool_end', name: tc.name, result };
          toolResultMap.set(tc.name, `Blocked: ${safety.reason}`);
          continue;
        }
      }

      if (tc.name === 'exec') {
        const hardline = guardrails.checkHardline(tc.args);
        if (hardline.blocked) {
          const result: ToolResult = { output: `Guardrail blocked: ${hardline.reason}`, success: false };
          yield { type: 'tool_end', name: tc.name, result };
          toolResultMap.set(tc.name, `Blocked: ${hardline.reason}`);
          continue;
        }
      }

      const preResult = await hookManager!.runPreTool(tc.name, tc.args);
      if (!preResult.allowed) {
        const result: ToolResult = { output: `Blocked by hook: ${preResult.output}`, success: false };
        yield { type: 'tool_end', name: tc.name, result };
        toolResultMap.set(tc.name, `Blocked: ${preResult.output}`);
        continue;
      }

      const rawResult = await toolRegistry.execute(tc.name, tc.args);
      const result = secretObfuscator?.hasSecrets()
        ? { ...rawResult, output: secretObfuscator.obfuscate(rawResult.output) }
        : rawResult;
      if (!result.success) {
        hadToolFailure = true;
        modelFailures[model] = (modelFailures[model] || 0) + 1;
        const loopDecision = updateFailureLoopGuard(failureLoopState, tc.name, result.output, tc.args);
        if (loopDecision.tripped) {
          yield { type: 'error', content: loopDecision.message };
          return;
        }
      } else {
        resetFailureLoopGuard(failureLoopState);
        result.output = truncateToolResult(result.output);
      }
      yield { type: 'tool_end', name: tc.name, result };
      recordToolCall(tc.name);

      // Track file operations for subagent tracker
      if (tc.name === 'read') {
        const pathMatch = tc.args.match(/^(\S+)/);
        if (pathMatch) trackSubagentFileRead('main', pathMatch[1]);
      } else if (tc.name === 'write' || tc.name === 'edit') {
        const pathMatch = tc.args.match(/^(\S+)/);
        if (pathMatch) trackSubagentFileWrite('main', pathMatch[1]);
      }

      // Auto-fix: run lint/test after write/edit tools
      if (result.success && shouldRunAutoFix(tc.name, { enabled: true, maxRetries: 3, timeoutMs: 30000 })) {
        try {
          const projectDir = process.cwd();
          const fixResult = await runAutoFix({ enabled: true, lint: 'npx tsc --noEmit', maxRetries: 3, timeoutMs: 30000 }, projectDir);
          const feedback = buildAutoFixFeedback(fixResult);
          if (feedback) {
            const existingResult = toolResultMap.get(tc.name) || result.output;
            toolResultMap.set(tc.name, existingResult + `\n\n${feedback}`);
            yield { type: 'thinking', content: '[Auto-fix: found errors after edit, feeding back to model]' };
          }
        } catch { /* auto-fix is best-effort */ }
      }

      const gResult = guardrails.recordResult(tc.name, result.success, result.output);
      if (gResult.stuck) {
        yield { type: 'error', content: `Agent stuck: ${gResult.reason}. ${guardrails.getSummary()}` };
        return;
      }

      if (result.success) {
        recordToolSuccess(tc.name);
      } else {
        const stuck = recordToolFailure(tc.name, result.output);
        if (stuck) {
          yield { type: 'error', content: `Agent stuck: ${tc.name} failed 3+ times. ${getFailureSummary()}` };
          return;
        }
      }

      await hookManager!.runPostTool(tc.name, tc.args, result.output);

      const withinBudget = turnBudget.canAddResult(result.output.length > 10000 ? 10000 : result.output.length);
      const formattedResult = withinBudget && result.output.length > 10000
        ? result.output.slice(0, 10000) + `\n... [truncated at 10000 chars]`
        : result.output;
      if (!withinBudget) {
        const warning = turnBudget.getOverflowWarning() || 'Turn budget exceeded';
        toolResultMap.set(tc.name, `[${warning}]`);
        turnBudget.addResult(tc.name, '[exceeded]');
      } else {
        turnBudget.addResult(tc.name, formattedResult);
        toolResultMap.set(tc.name, formattedResult);
      }
    }

    // Send tool results back to the model.
    // If we got STRUCTURED tool calls from the API (pendingToolCalls), use
    // role='tool' with tool_call_id — this is the proper OpenAI format.
    // If we only got TEXT-BASED tool calls (extractToolCalls), use role='user'
    // with a "Tool results:" prefix — the API rejects role='tool' messages
    // that don't have a matching tool_calls in the preceding assistant message.
    if (pendingToolCalls.length > 0) {
      // Structured: push individual tool messages with tool_call_id.
      const toolCallIdMap = new Map<string, string>();
      for (const tc of pendingToolCalls) {
        toolCallIdMap.set(tc.name, tc.id || `call_${tc.name}_${Date.now()}`);
      }
      for (const tc of turnToolCalls) {
        const toolCallId = toolCallIdMap.get(tc.name) || `call_${tc.name}_${Date.now()}`;
        const resultText = toolResultMap.get(tc.name) || 'No output';
        messages.push({
          role: 'tool' as const,
          content: resultText,
          tool_call_id: toolCallId,
        } as any);
      }
    } else {
      // Text-based: push as user message (legacy format).
      // This avoids the API rejecting role='tool' messages without
      // matching tool_calls in the assistant message.
      let toolOutput = '';
      for (const tc of turnToolCalls) {
        const resultText = toolResultMap.get(tc.name) || 'No output';
        toolOutput += `\n\nTool ${tc.name}:\n${resultText}`;
      }
      messages.push({
        role: 'user' as const,
        content: `Tool results:${toolOutput}`,
      });
    }

    // End turn lifecycle
    endTurn('completed');
    // Update subagent progress for main agent
    trackSubagentProgress('main', allToolCalls.length);

    // Observability: record activity
    recordActivity({ type: 'tool_call', detail: turnToolCalls.map(t => t.name).join(', '), metadata: { turn } });

    // Memory extraction: learn from this turn
    const extracted = extractMemories('assistant', turnText, input);
    if (extracted.length > 0) storeMemories(extracted);
  }

  sessionManager!.addMessage({ role: 'user', content: input });
  sessionManager!.addMessage({ role: 'assistant', content: fullContent });

  // Record model performance for learned selection (Fugu-style)
  const cStats = getSessionStats();

  // Record model performance for learned selection (Fugu-style)
  if (hadToolFailure) {
    recordFailure(route.taskType, provider.name, model);
  } else {
    recordSuccess(route.taskType, provider.name, model, cStats.totalDuration, cStats.inputTokens + cStats.outputTokens);
  }

  // Check for silent failures
  const silentFailures = detectSilentFailures();
  if (silentFailures.length > 0) {
    const highSeverity = silentFailures.filter(f => f.severity === 'high');
    if (highSeverity.length > 0) {
      yield { type: 'thinking', content: `[Observability: ${highSeverity[0].type} detected — ${highSeverity[0].suggestion}]` };
    }
  }

  // End lifecycle session
  endSession();

  yield { type: 'done', content: fullContent, route };
}

// ─── Simple Chat ────────────────────────────────────────────────

export async function chat(
  input: string,
  history: ChatMessage[],
  options: EngineOptions = {},
): Promise<{ response: string; route: ModelRoute; history: ChatMessage[] }> {
  if (input.startsWith('/')) {
    return handleCmd(input, history, options);
  }

  let fullContent = '';
  let finalRoute: ModelRoute = {
    taskType: 'general' as any,
    provider: 'nvidia',
    model: 'gpt-oss-20b',
    thinking: false,
    routed: false,
  };

  for await (const event of agentLoop(input, history, { ...options, stream: false })) {
    if (event.type === 'done') {
      fullContent = event.content;
      finalRoute = event.route;
    } else if (event.type === 'text') {
      fullContent += event.content;
    } else if (event.type === 'route') {
      finalRoute = event.route;
    } else if (event.type === 'error') {
      return { response: event.content, route: finalRoute, history };
    }
  }

  const newHist: ChatMessage[] = [...history, { role: 'user', content: input }, { role: 'assistant', content: fullContent }];
  return { response: fullContent, route: finalRoute, history: newHist };
}

// ─── Commands ───────────────────────────────────────────────────

function handleCmd(input: string, history: ChatMessage[], options: EngineOptions) {
  const cmd = input.split(' ')[0];
  const defaultRoute: ModelRoute = { taskType: 'general' as any, provider: 'local', model: 'local', thinking: false, routed: false };

  switch (cmd) {
    case '/help':
      return {
        response: `Kairo Commands:
  /help     — Show this help
  /status   — Provider status
  /clear    — Clear history
  /tools    — List available tools
  /skills   — List loaded skills
  /hooks    — List active hooks
  /session  — Show current session
  /compact  — Compact context to save tokens
  /agents   — List available agents
  /workflow  — Run a workflow
  /model    — Switch model
  /think    — Toggle thinking mode
  /usage    — Show tool usage stats
  /stats    — Session cost and token stats
  /curator  — Show curator insights and self-improvement data

Tools: ${toolRegistry.getNames().map(t => '!' + t).join(' ')}`,
        route: defaultRoute, history,
      };

    case '/status':
      return {
        response: `Providers: ${getRegistry().getAvailable().join(', ') || 'none'}\nMode: MoE routing`,
        route: defaultRoute, history,
      };

    case '/clear':
      return { response: 'Cleared.', route: defaultRoute, history: [] };

    case '/tools':
      return {
        response: toolRegistry.getAll().map(t => `  ${t.name} — ${t.description}`).join('\n'),
        route: defaultRoute, history,
      };

    case '/usage': {
      const report = getToolUsageReport();
      return {
        response: report ? `Tool Usage:\n${report}` : 'No tool usage recorded.',
        route: defaultRoute, history,
      };
    }

    case '/stats': {
      return {
        response: formatStats(),
        route: defaultRoute, history,
      };
    }

    case '/curator': {
      return {
        response: generateReport(),
        route: defaultRoute, history,
      };
    }

    default:
      return { response: `Unknown: ${cmd}. Type /help`, route: defaultRoute, history };
  }
}
