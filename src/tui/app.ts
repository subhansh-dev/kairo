import { TUIEngine } from './engine.js';
import { FrameComponent, BoxComponent, TextComponent, ChatComponent, InputComponent, StatusBarComponent, ThinkingComponent, kairoBrand, modelInfoBlock, planModeIndicator, keyPoolStatus, type ChatMessage, type ToolCallState } from './components.js';
import { AgentOverlayComponent } from './agent-overlay.js';
import { theme } from './theme.js';
import { getRouteSync, type ModelRoute, TaskType } from '../core/router.js';
import { getRegistry } from '../providers/registry.js';
import { agentLoop, type EngineEvent, type EngineOptions } from '../core/engine.js';
import { estimateTotalTokens } from '../core/compaction.js';
import { toolRegistry } from '../tools/index.js';
import { isInPlanMode } from '../tools/plan.js';
import { getCredentialPool } from '../providers/credential-pool.js';
import { SkillLoader } from '../skills/loader.js';
import { formatResponse } from './syntax.js';
import { getSubagentStats, buildSparkline, getSubagentTree } from '../core/subagent-tracker.js';
import { getCurrentTurn } from '../core/agent-lifecycle.js';
import { getToolStartMessage, getToolSuccessMessage, getToolErrorMessage, formatToolCallSummary, formatThinkingWithTool, getTaskGreeting, resetPersonality } from '../core/personality.js';

const R = '\x1b[0m', B = '\x1b[1m', D = '\x1b[2m';
const c = theme.colors;

export interface CLIOptions {
  help?: boolean; status?: boolean; smol?: boolean; slow?: boolean;
  plan?: boolean; debug?: boolean; swarm?: boolean;
  model?: string; provider?: string; exec?: string;
  workflow?: string; agent?: string; prompt?: string;
}

function parseArgs(args: string[]): CLIOptions {
  const opts: CLIOptions = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--help': case '-h': opts.help = true; break;
      case '--status': opts.status = true; break;
      case '--smol': opts.smol = true; break;
      case '--slow': opts.slow = true; break;
      case '--plan': opts.plan = true; break;
      case '--swarm': opts.swarm = true; break;
      case '--debug': opts.debug = true; break;
      case '-m': case '--model': opts.model = args[++i]; break;
      case '-p': case '--provider': opts.provider = args[++i]; break;
      case '-e': case '--exec': opts.exec = args[++i]; break;
      case '-w': case '--workflow': opts.workflow = args[++i]; break;
      case '-a': case '--agent': opts.agent = args[++i]; break;
      default: if (!a.startsWith('-')) opts.prompt = (opts.prompt || '') + (opts.prompt ? ' ' : '') + a;
    }
  }
  return opts;
}

function showHelp() {
  process.stdout.write(`
  ${B}${c.primary}Usage:${R} kairo [options] [prompt]

  ${B}${c.primary}Options:${R}
    ${c.primary}-m, --model${R} <model>      Model override
    ${c.primary}-p, --provider${R} <name>    Provider
    ${c.primary}--smol${R}                   Fast mode (Groq)
    ${c.primary}--slow${R}                   Reasoning mode (DeepSeek R1)
    ${c.primary}--swarm${R}                  Multi-agent swarm mode
    ${c.primary}-w, --workflow${R} <name>    Workflow
    ${c.primary}-a, --agent${R} <name>       Agent
    ${c.primary}-e, --exec${R} <prompt>      One-shot
    ${c.primary}--status${R}                 Provider status

  ${B}${c.primary}Commands:${R}
    ${c.secondary}/help${R}  /status  /clear  /tools  /model  /think
    ${c.secondary}/compact${R}  /session  /agents  /workflow  /stats
    ${c.secondary}/context${R}  /save  /resume  /sessions  /diff
    ${c.secondary}/doctor${R}  /init  /review  /export  /toolsets
    ${c.secondary}/stuck${R}  /shake  /plan  /skills  /search

  ${B}${c.primary}Tools:${R} ${toolRegistry.getNames().map(t => `${c.accent}!${t}${R}`).join(' ')}

  ${D}${c.muted}Config: ~/.kairo/models.yml${R}
`);
}

export async function tui() {
  const args = process.argv.slice(2);
  const opts = parseArgs(args);
  if (opts.help) { showHelp(); process.exit(0); }

  const registry = getRegistry();

  if (opts.status) {
    process.stdout.write(`\n${B}${c.primary}  Provider Status${R}\n\n`);
    for (const name of ['nvidia', 'groq', 'cerebras']) {
      const p = registry.get(name);
      process.stdout.write(`  ${p ? `${c.success}●${R}` : `${c.muted}○${R}`} ${name}${p ? ` ${D}(${p.models.slice(0, 3).join(', ')})${R}` : ''}\n`);
    }
    process.stdout.write(`\n${D}  Available: ${registry.getAvailable().join(', ') || 'none'}${R}\n\n`);
    process.exit(0);
  }

  const available = registry.getAvailable();
  if (available.length === 0) {
    process.stdout.write(`\n${c.error}${B}  No providers!${R} Create ~/.kairo/models.yml or run: ${c.primary}kairo --init${R}\n\n`);
    process.exit(1);
  }

  const defaults = registry.getDefaults();

  // Cached instances for updateStatus (avoid recreating on every keystroke)
  let cachedSkillLoader: SkillLoader | null = null;

  // One-shot exec mode
  if (opts.exec || opts.prompt) {
    const prompt = opts.exec || opts.prompt!;
    const start = Date.now();
    resetPersonality();
    process.stdout.write(`${getTaskGreeting(prompt)}\n\n`);
    for await (const event of agentLoop(prompt, [], opts)) {
      if (event.type === 'text') {
        process.stdout.write(event.content); // Write raw text without formatting
        if (opts.debug) process.stderr.write(`[DEBUG: text="${event.content}"]\n`);
      }
      else if (event.type === 'error') process.stdout.write(`\n${c.error}  ✗ ${event.content}${R}\n`);
      else if (event.type === 'tool_start') {
        const msg = getToolStartMessage(event.name, event.args);
        process.stdout.write(`\n${msg}\n`);
      }
      else if (event.type === 'tool_end') {
        if (event.result.success) {
          const msg = getToolSuccessMessage(event.name);
          process.stdout.write(`${msg}\n`);
        } else {
          const msg = getToolErrorMessage(event.name, event.result.output?.slice(0, 60));
          process.stdout.write(`${msg}\n`);
        }
      }
      else if (event.type === 'done') {
        const elapsed = Date.now() - start;
        process.stdout.write(`\n${D}  ${event.route.provider}/${event.route.model} · ${(elapsed / 1000).toFixed(1)}s${R}\n`);
      }
      else if (opts.debug) {
        process.stderr.write(`[DEBUG: event type=${event.type}]\n`);
      }
    }
    process.exit(0);
  }

  const engine = new TUIEngine();

  const chatComp = new ChatComponent();
  const inputComp = new InputComponent();
  const statusComp = new StatusBarComponent();
  const thinkingComp = new ThinkingComponent();
  const logoComp = new TextComponent('');
  const agentOverlay = new AgentOverlayComponent();

  const logoText = kairoBrand().join('\n');
  logoComp.setText(logoText);

  const modelPct = 0;
  const modelLines = modelInfoBlock(defaults.model, defaults.provider, modelPct);
  const modelText = new TextComponent(modelLines.join('\n'));

  const chatBox = new BoxComponent([chatComp], {
    title: 'chat',
    borderColor: c.subtle,
    paddingX: 1,
    paddingY: 0,
  });

  let abortController: AbortController | null = null;
  let messageQueue: string[] = [];
  let processing = false;

  const mainLayout = new FrameComponent([
    logoComp,
    modelText,
    thinkingComp,
    chatBox,
    inputComp,
    statusComp,
    agentOverlay,
  ]);

  // Status bar updater — refreshes with context, plan, skills, key pool info
  function updateStatus() {
    const msgs = chatComp.getMessages();
    const msgCount = msgs.length;

    // Context usage estimate
    let ctxInfo = '';
    try {
      const tokens = estimateTotalTokens(msgs);
      const maxTokens = 128000;
      const pct = Math.round((tokens / maxTokens) * 100);
      ctxInfo = `${msgCount}msgs ${D}·${R} ${pct}%`;
      if (pct > 80) ctxInfo += ` ${c.warning}⚠${R}`;
    } catch { ctxInfo = `${msgCount}msgs`; }

    // Plan mode indicator
    let planInfo = '';
    try {
      if (isInPlanMode()) planInfo = `${c.warning}PLAN${R}`;
    } catch {}

    // Key pool status
    let keysInfo = '';
    try {
      const poolStatus = getCredentialPool().getStatus();
      for (const [p, s] of Object.entries(poolStatus) as any) {
        if (s.available < s.total) keysInfo = `${c.warning}${p}:${s.available}/${s.total}${R}`;
      }
    } catch {}

    // Active skills count
    let skillsInfo = '';
    try {
      // Reuse cached loader instance instead of creating new one per call
      if (!cachedSkillLoader) cachedSkillLoader = new SkillLoader();
      const always = cachedSkillLoader.getAlwaysApply();
      if (always.length > 0) skillsInfo = `${c.primary}${always.length}skills${R}`;
    } catch {}

    const parts = [ctxInfo, planInfo, keysInfo, skillsInfo].filter(Boolean);
    statusComp.setLeftText(parts.join(` ${D}·${R} `));
  }

  // Initial status update
  updateStatus();

  engine.setRoot(mainLayout);

  // Tick thinking animation frames
  engine.setOnTick(() => {
    thinkingComp.tick();
  });

  // Wire interrupt signal from ESC/Ctrl+C keybindings
  engine.setKeybindingHandler((action: string) => {
    // When agent overlay is visible, forward interrupt/close to it
    if (agentOverlay.isVisible()) {
      if (action === 'interrupt' || action === 'agents.toggle') {
        agentOverlay.hide();
        engine.requestRender();
        return;
      }
      return;
    }
    if ((action === 'interrupt' || action === 'escape') && abortController) {
      abortController.abort();
      abortController = null;
      statusComp.setLeftText(`${c.warning}⏹ Interrupting...${R}`);
      engine.requestRender();
    }
    if (action === 'agents.toggle') {
      agentOverlay.toggle();
      engine.requestRender();
    }
  });

  // Global input handler: route raw keys to overlay when visible
  engine.setGlobalInputHandler((char: string): boolean => {
    if (!agentOverlay.isVisible()) return false;
    agentOverlay.handleInput(char);
    engine.requestRender();
    return true;
  });

  async function processQueue() {
    if (processing || messageQueue.length === 0) return;
    processing = true;
    statusComp.setLeftText(`${c.primary}Processing queue${R}`);
    engine.requestRender();

    try {
      while (messageQueue.length > 0) {
        const input = messageQueue.shift()!;
        inputComp.setBuffer('');
        const isSlashCmd = input.startsWith('/');

        // Create fresh abort controller for this message
        abortController = new AbortController();
        const signal = abortController.signal;

        // Auto-timeout: 120s per message to prevent hangs
        const msgTimeout = setTimeout(() => {
          if (abortController) {
            abortController.abort();
            chatComp.setMessages([...chatComp.getMessages(), { role: 'assistant', content: `${c.error}⏱ Timed out after 120s${R}` }]);
            engine.requestRender();
          }
        }, 120_000);

        if (isSlashCmd) {
          const cmd = input.split(' ')[0];
          const arg = input.slice(cmd.length).trim();
          clearTimeout(msgTimeout);
          await handleTuiCommand(cmd, arg, opts, chatComp, statusComp, engine, defaults);
          inputComp.setBuffer('');
          engine.requestRender();
          continue;
        }

        const userMsg: ChatMessage = { role: 'user', content: input };
        const placeholderMsg: ChatMessage = { role: 'assistant', content: '' };
        chatComp.setMessages([...chatComp.getMessages(), userMsg, placeholderMsg]);
        updateStatus();
        statusComp.setLeftText(`${c.primary}→ ${input.slice(0, 30)}${input.length > 30 ? '…' : ''}${R}`);
        engine.requestRender();

        const startTime = Date.now();
        const toolCalls: ToolCallState[] = [];
        let interrupted = false;
        let thinkingStartTime = Date.now();
        resetPersonality();

        // Show a personality greeting
        const greeting = getTaskGreeting(input);
        const greetMsgs = chatComp.getMessages();
        if (greetMsgs.length > 0 && greetMsgs[greetMsgs.length - 1].role === 'assistant') {
          const updated = greetMsgs.map((m, i) => i === greetMsgs.length - 1 ? { ...m, content: m.content + '\n' + greeting } : m);
          chatComp.setMessages(updated);
        }

        thinkingComp.start(input);
        statusComp.setStreaming(true);
        engine.requestRender();
        engine.startAnimation(80);

        try {
          for await (const event of agentLoop(input, chatComp.getMessages(), {
            ...opts, stream: true, thinking: !!opts.slow, signal,
          })) {
            if (signal.aborted) {
              interrupted = true;
              break;
            }
          switch (event.type) {
            case 'text': {
              const msgs = chatComp.getMessages();
              if (msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
                const updated = msgs.map((m, i) => i === msgs.length - 1 ? { ...m, content: m.content + event.content } : m);
                chatComp.setMessages(updated);
              } else {
                chatComp.setMessages([...msgs, { role: 'assistant' as const, content: event.content }]);
              }
              engine.requestDiffRender();
              break;
            }
            case 'thinking':
              thinkingComp.addThought(event.content);
              engine.requestRender();
              break;
            case 'tool_start': {
                const tcId = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                const tc: ToolCallState = { id: tcId, name: event.name, args: event.args, status: 'running', startTime: Date.now() };
                toolCalls.push(tc);
                chatComp.setToolCalls([...toolCalls]);

                // Show thinking duration + tool call with personality
                const thinkDur = Date.now() - thinkingStartTime;
                const statusMsg = thinkDur > 500
                  ? formatThinkingWithTool(thinkDur, event.name)
                  : getToolStartMessage(event.name, event.args);
                statusComp.setLeftText(statusMsg);

                // Update turn tracking in status bar
                const curTurn = getCurrentTurn();
                if (curTurn) {
                  statusComp.setAgentRole(curTurn.role);
                  statusComp.setAgentModel(curTurn.model);
                }
                statusComp.setTurnToolCalls(toolCalls.length);
                statusComp.setTurnElapsed(`${((Date.now() - startTime) / 1000).toFixed(1)}s`);
                engine.requestRender();
                break;
              }
              case 'tool_end': {
                const found = toolCalls.find(t => t.name === event.name);
                if (found) {
                  found.status = event.result.success ? 'success' : 'error';
                  found.result = event.result.output;
                  found.durationMs = Date.now() - (found.startTime || Date.now());
                }
                chatComp.setToolCalls([...toolCalls]);
                thinkingStartTime = Date.now(); // Reset thinking timer for next gap

                // Show personality-driven completion message
                if (found) {
                  if (event.result.success) {
                    statusComp.setLeftText(getToolSuccessMessage(event.name, found.durationMs));
                  } else {
                    statusComp.setLeftText(getToolErrorMessage(event.name, event.result.output?.slice(0, 60)));
                  }
                }

                statusComp.setTurnToolCalls(toolCalls.length);
                statusComp.setTurnElapsed(`${((Date.now() - startTime) / 1000).toFixed(1)}s`);
                engine.requestRender();
                break;
              }
              case 'error':
                chatComp.setMessages([...chatComp.getMessages(), { role: 'assistant', content: `${c.error}Error: ${event.content}${R}` }]);
                engine.requestRender();
                break;
              case 'route': {
                // Update status bar with routed model info in real-time
                statusComp.setModelInfo(`${event.route.provider}/${event.route.model}`);
                engine.requestDiffRender();
                break;
              }
              case 'coordinator': {
                // Show coordinator role in status
                const roleEmoji: Record<string, string> = { thinker: '🧠', worker: '⚙️', verifier: '✅', fast: '⚡' };
                statusComp.setLeftText(`${c.accent}${roleEmoji[event.role] || '●'} ${event.role}${R}`);
                engine.requestDiffRender();
                break;
              }
              case 'provider_switch': {
                statusComp.setLeftText(`${c.warning}⟳${R} ${event.from} → ${event.to}`);
                statusComp.setModelInfo(`${event.to}`);
                engine.requestRender();
                break;
              }
              case 'done': {
                const elapsed = Date.now() - startTime;
                statusComp.setModelInfo(`${event.route.provider}/${event.route.model} ${D}·${R} ${(elapsed / 1000).toFixed(1)}s`);
                thinkingComp.stop();
                engine.stopAnimation();
                // Add completion message with tool call summary
                const toolSummary = formatToolCallSummary(toolCalls);
                const doneMsg = toolSummary
                  ? `${c.success}✓${R} ${D}Done${R} ${c.muted}·${R} ${D}${event.route.provider}/${event.route.model} · ${(elapsed / 1000).toFixed(1)}s${R}\n${toolSummary}`
                  : `${c.success}✓${R} ${D}Done${R} ${c.muted}·${R} ${D}${event.route.provider}/${event.route.model} · ${(elapsed / 1000).toFixed(1)}s${R}`;
                const currentMsgs = chatComp.getMessages();
                if (currentMsgs.length > 0 && currentMsgs[currentMsgs.length - 1].role === 'assistant') {
                  // Append to last assistant message
                  const updated = currentMsgs.map((m, i) => i === currentMsgs.length - 1 ? { ...m, content: m.content + '\n\n' + doneMsg } : m);
                  chatComp.setMessages(updated);
                } else {
                  chatComp.setMessages([...currentMsgs, { role: 'assistant', content: doneMsg }]);
                }
                // Update subagent stats in status bar
                const saStats = getSubagentStats();
                if (saStats.totalActive > 0 || saStats.totalCompleted > 0) {
                  statusComp.setActiveAgentCount(saStats.totalActive);
                  statusComp.setAgentSparkline(buildSparkline(getSubagentTree()));
                }
                updateStatus();
                engine.requestRender();
                break;
              }
              case 'agent_spawn': {
                statusComp.setLeftText(`${c.accent}🤖 ${event.agent} spawned${R}`);
                const spawnStats = getSubagentStats();
                statusComp.setActiveAgentCount(spawnStats.totalActive);
                statusComp.setAgentSparkline(buildSparkline(getSubagentTree()));
                engine.requestRender();
                break;
              }
              case 'agent_complete': {
                const compStats = getSubagentStats();
                statusComp.setActiveAgentCount(compStats.totalActive);
                statusComp.setAgentSparkline(buildSparkline(getSubagentTree()));
                engine.requestRender();
                break;
              }
            }
          }
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            chatComp.setMessages([...chatComp.getMessages(), { role: 'assistant', content: `${c.error}✗ ${err.message}${R}` }]);
          }
        }

        if (interrupted) {
          chatComp.setMessages([...chatComp.getMessages(), { role: 'assistant', content: `${c.warning}⏹ Interrupted by user${R}` }]);
        }

        clearTimeout(msgTimeout);
        thinkingComp.stop();
        engine.stopAnimation();
        statusComp.setStreaming(false);
        abortController = null;
        updateStatus();
        engine.requestRender();
      }
    } catch (err: any) {
      statusComp.setLeftText(`${c.error}Queue error: ${err.message}${R}`);
    } finally {
      processing = false;
      inputComp.setBuffer('');
      statusComp.setLeftText(`${c.success}Ready${R}`);
      engine.requestRender();
    }
  }

  inputComp.setOptions({
    placeholder: `Ask kairo something... (${defaults.model})`,
    onSubmit: async (val: string) => {
      const input = val.trim();
      if (!input) return;

      messageQueue.push(input);
      inputComp.setBuffer('');
      engine.requestRender();

      if (processing) {
        statusComp.setLeftText(`${c.primary}${messageQueue.length} queued${R}`);
        engine.requestRender();
        return;
      }

      await processQueue();
    },
    onBufferChange: (val: string) => {
      statusComp.setLeftText(val ? `${D}${val.length} chars${R}` : '');
      engine.requestDiffRender();
    },
  });

  engine.start();
}

async function handleTuiCommand(
  cmd: string,
  arg: string,
  opts: CLIOptions,
  chatComp: ChatComponent,
  statusComp: StatusBarComponent,
  engine: TUIEngine,
  defaults: any
) {
  const msgs: ChatMessage[] = chatComp.getMessages();
  switch (cmd) {
    case '/help':
      showHelp();
      break;
    case '/clear':
      chatComp.setMessages([]);
      break;
    case '/status': {
      const registry = getRegistry();
      const av = registry.getAvailable();
      chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.primary}Providers:${R} ${av.join(', ')}` }]);
      break;
    }
    case '/model': {
      if (!arg) {
        const registry = getRegistry();
        for (const p of registry.getAll()) {
          chatComp.setMessages([...msgs, { role: 'assistant', content: `  ${c.primary}${p.name}${R}: ${p.models.join(', ')}` }]);
        }
      } else {
        opts.model = arg;
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.success}Model: ${arg}${R}` }]);
      }
      break;
    }
    case '/think': {
      opts.slow = !opts.slow;
      chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.success}Thinking: ${opts.slow ? 'on' : 'off'}${R}` }]);
      break;
    }
    case '/tools': {
      const all = toolRegistry.getAll();
      const lines = all.map(t => `  ${c.primary}${t.name}${R} — ${t.description}`);
      chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.primary}Tools:${R}\n${lines.join('\n')}` }]);
      break;
    }
    case '/compact':
      break;
    case '/session': {
      chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.primary}Model:${R} ${opts.model || 'default'}` }]);
      break;
    }
    case '/stats': case '/cost': {
      try {
        const { formatStats } = await import('../core/cost-tracker.js');
        chatComp.setMessages([...msgs, { role: 'assistant', content: formatStats() }]);
      } catch {}
      break;
    }
    case '/doctor': {
      const reg = getRegistry();
      const { existsSync } = await import('fs');
      const { homedir } = await import('os');
      const { join } = await import('path');
      const config = existsSync(join(homedir(), '.kairo', 'models.yml'));
      chatComp.setMessages([...msgs, {
        role: 'assistant',
        content: `${c.primary}Doctor${R}\n  Providers: ${reg.getAvailable().length > 0 ? `${c.success}${reg.getAvailable().length}${R}` : `${c.error}none${R}`}\n  Node: ${c.success}${process.version}${R}\n  Config: ${config ? `${c.success}yes${R}` : `${c.warning}no${R}`}`
      }]);
      break;
    }
    case '/agents': {
      try {
        const { listAgents } = await import('../agents/orchestrator.js');
        const agents = listAgents();
        const lines = agents.map(a => `  ${c.primary}${a.name}${R} — ${a.description}`);
        // Also show subagent tracker stats
        const { getSubagentStats: getStats, formatDuration: fmtDur, buildSparkline: buildSp } = await import('../core/subagent-tracker.js');
        const { getSubagentTree: getTree } = await import('../core/subagent-tracker.js');
        const saStats = getStats();
        if (saStats.totalActive > 0 || saStats.totalCompleted > 0 || saStats.totalFailed > 0) {
          const spark = buildSp(getTree());
          lines.push('', `  ${c.primary}Subagents:${R} ${saStats.totalActive} active, ${saStats.totalCompleted} done, ${saStats.totalFailed} failed, ${saStats.totalTools} tools, ${fmtDur(saStats.totalDuration)} ${spark}`);
        }
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.primary}Agents:${R}\n${lines.join('\n')}` }]);
      } catch {}
      break;
    }
    case '/workflow': {
      if (!arg) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Usage: /workflow <name> <task>${R}` }]);
        break;
      }
      const [wf, ...rest] = arg.split(/\s+/);
      const task = rest.join(' ');
      if (!task) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Usage: /workflow ${wf} <task>${R}` }]);
        break;
      }
      try {
        const { runWorkflow } = await import('../agents/orchestrator.js');
        const result = await runWorkflow(wf, task, {});
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.primary}Workflow: ${wf}${R}\n${result.summary || 'Done.'}` }]);
      } catch (e: any) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Error: ${e.message}${R}` }]);
      }
      break;
    }
    case '/review': {
      if (!arg) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Usage: /review <task>${R}` }]);
        break;
      }
      try {
        const { runAgent } = await import('../agents/orchestrator.js');
        const result = await runAgent('reviewer', arg);
        chatComp.setMessages([...msgs, { role: 'assistant', content: result.output }]);
      } catch (e: any) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Error: ${e.message}${R}` }]);
      }
      break;
    }
    case '/save': {
      try {
        const { createSession, saveSession, autoTitle } = await import('../session/persistence.js');
        const s = createSession(opts.model || defaults.model, defaults.provider);
        s.title = autoTitle(s);
        saveSession(s);
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.success}Saved: ${s.id} — "${s.title}"${R}` }]);
      } catch (e: any) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Error: ${e.message}${R}` }]);
      }
      break;
    }
    case '/sessions': case '/resume': {
      try {
        const { listSessions, loadSession, formatSessionList } = await import('../session/persistence.js');
        const sessions = listSessions(10);
        if (!arg) {
          chatComp.setMessages([...msgs, { role: 'assistant', content: `${formatSessionList(sessions)}\n${D}/resume <number>${R}` }]);
          break;
        }
        const idx = parseInt(arg) - 1;
        const s = (!isNaN(idx) && idx >= 0 && idx < sessions.length) ? sessions[idx] : loadSession(arg);
        if (!s) { chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Not found.${R}` }]); break; }
        chatComp.setMessages(s.messages as ChatMessage[]);
        opts.model = s.model;
        chatComp.setMessages([...s.messages as ChatMessage[], { role: 'assistant', content: `${c.success}Resumed: "${s.title}" (${s.messages.length} msgs)${R}` }]);
      } catch (e: any) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Error: ${e.message}${R}` }]);
      }
      break;
    }
    case '/init': {
      try {
        const { existsSync, mkdirSync, writeFileSync } = await import('fs');
        const { homedir } = await import('os');
        const { join } = await import('path');
        const dir = join(homedir(), '.kairo');
        const p = join(dir, 'models.yml');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        if (existsSync(p)) {
          chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.warning}Exists: ${p}${R}` }]);
          break;
        }
        writeFileSync(p, `# Kairo Config\nproviders:\n  nvidia:\n    apiKey: "nvapi-your-key"\n  groq:\n    apiKey: "gsk-your-key"\n`);
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.success}Created: ${p}${R}` }]);
      } catch (e: any) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Error: ${e.message}${R}` }]);
      }
      break;
    }
    case '/context': {
      try {
        const { buildFullContext } = await import('../core/context.js');
        const ctx = buildFullContext();
        chatComp.setMessages([...msgs, { role: 'assistant', content: ctx.combined || `${D}No context.${R}` }]);
      } catch {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${D}No context.${R}` }]);
      }
      break;
    }
    case '/diff': {
      try {
        const { execSync } = await import('child_process');
        const out = execSync('git diff --stat', { encoding: 'utf-8', stdio: 'pipe' });
        chatComp.setMessages([...msgs, { role: 'assistant', content: out || `${D}No changes.${R}` }]);
      } catch {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${D}Not a git repo.${R}` }]);
      }
      break;
    }
    case '/export': {
      const exportMsgs = chatComp.getMessages();
      const lines = exportMsgs.map(m => `## ${m.role}\n\n${m.content}\n`);
      const { writeFileSync } = await import('fs');
      const fn = `kairo-export-${Date.now()}.md`;
      writeFileSync(fn, `# Kairo Export\n\n${lines.join('\n')}`);
      chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.success}Exported: ${fn}${R}` }]);
      break;
    }
    case '/skills': {
      try {
        const { SkillLoader } = await import('../skills/loader.js');
        const loader = new SkillLoader();
        const all = loader.all();
        if (all.length === 0) {
          chatComp.setMessages([...msgs, { role: 'assistant', content: `${D}No skills loaded.${R}` }]);
        } else {
          const always = loader.getAlwaysApply();
          const lines = all.map(s =>
            `  ${c.primary}${s.name}${R}${s.frontmatter?.alwaysApply ? ` ${c.success}[always]${R}` : ''}${s.frontmatter?.description ? ` ${D}· ${s.frontmatter.description}${R}` : ''}`
          );
          lines.push('', `${D}${all.length} total, ${always.length} always-apply${R}`);
          chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.primary}${B}Skills:${R}\n${lines.join('\n')}` }]);
        }
      } catch { chatComp.setMessages([...msgs, { role: 'assistant', content: `${D}Skills not available.${R}` }]); }
      break;
    }
    case '/plan': {
      try {
        const { getPlanState } = await import('../tools/plan.js');
        const ps = getPlanState();
        if (!ps.active) {
          chatComp.setMessages([...msgs, { role: 'assistant', content: `${D}Not in plan mode. Use the enter_plan_mode tool to start.${R}` }]);
        } else {
          const lines = [
            `  ${c.warning}${B}Plan Mode: ACTIVE${R}`,
            `  ${D}Steps: ${ps.steps.length}${R}`,
            `  ${D}Plan file: ${ps.planFile || 'none'}${R}`,
            `  ${ps.approved ? `${c.success}Approved${R}` : `${c.warning}Not yet approved${R}`}`,
          ];
          chatComp.setMessages([...msgs, { role: 'assistant', content: lines.join('\n') }]);
        }
      } catch { chatComp.setMessages([...msgs, { role: 'assistant', content: `${D}Plan mode not available.${R}` }]); }
      break;
    }
    case '/stuck': {
      try {
        const { isStuck } = await import('../core/safety.js');
        const s = isStuck();
        chatComp.setMessages([...msgs, { role: 'assistant', content: s?.stuck ? `${c.error}Stuck: ${s.tool}${R}` : `${c.success}OK${R}` }]);
      } catch {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${D}Safety not available.${R}` }]);
      }
      break;
    }
    case '/shake': {
      try {
        const { shakeLargeOutputs } = await import('../core/compaction.js');
        const shaken = shakeLargeOutputs(chatComp.getMessages());
        chatComp.setMessages(shaken);
        chatComp.setMessages([...chatComp.getMessages(), { role: 'assistant', content: `${c.success}Shaken ${shaken.length} messages.${R}` }]);
      } catch {
        chatComp.setMessages([...chatComp.getMessages(), { role: 'assistant', content: `${D}Not available.${R}` }]);
      }
      break;
    }
    case '/search': {
      try {
        const { searchSessions, browseSessions, formatSearchResult } = await import('../session/search.js');
        if (!arg) {
          const result = browseSessions();
          chatComp.setMessages([...msgs, { role: 'assistant', content: formatSearchResult(result) }]);
        } else {
          const result = searchSessions(arg);
          chatComp.setMessages([...msgs, { role: 'assistant', content: formatSearchResult(result) }]);
        }
      } catch (e: any) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Error: ${e.message}${R}` }]);
      }
      break;
    }
    case '/toolsets': {
      try {
        const { listToolsets } = await import('../tools/toolsets.js');
        const all = listToolsets();
        const lines = all.map((t: any) => `  ${c.primary}${t.name}${R} — ${t.description}`);
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.primary}Toolsets:${R}\n${lines.join('\n')}` }]);
      } catch {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${D}Not available.${R}` }]);
      }
      break;
    }
    case '/fork': {
      try {
        const { forkSession, formatForkList } = await import('../session/fork.js');
        if (!arg) {
          const forkList = formatForkList('current');
          chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.primary}Forks:${R}\n${forkList}\n${D}/fork <label> to create${R}` }]);
        } else {
          const fork = forkSession('current', chatComp.getMessages(), chatComp.getMessages().length - 1, arg);
          chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.success}Forked: ${fork.id} — "${fork.label}"${R}` }]);
        }
      } catch (e: any) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Error: ${e.message}${R}` }]);
      }
      break;
    }
    case '/diag': case '/diagnostics': {
      try {
        const { getDiagnostics } = await import('../core/observability.js');
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.primary}Diagnostics:${R}\n${getDiagnostics()}` }]);
      } catch (e: any) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Error: ${e.message}${R}` }]);
      }
      break;
    }
    case '/memory': {
      try {
        const { getMemoryStats, formatMemoriesForContext } = await import('../core/memory-extract.js');
        const stats = getMemoryStats();
        const recent = formatMemoriesForContext(undefined, 10);
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.primary}Memory:${R} ${stats.total} entries\n${recent || 'No memories yet.'}` }]);
      } catch (e: any) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Error: ${e.message}${R}` }]);
      }
      break;
    }
    case '/cache': {
      try {
        const { getCacheStats } = await import('../core/result-cache.js');
        const stats = getCacheStats();
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.primary}Cache:${R} ${stats.size} entries, ${stats.hits} hits` }]);
      } catch (e: any) {
        chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Error: ${e.message}${R}` }]);
      }
      break;
    }
    default:
      chatComp.setMessages([...msgs, { role: 'assistant', content: `${c.error}Unknown: ${cmd}. /help${R}` }]);
  }
  engine.requestRender();
}
