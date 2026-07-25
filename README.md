# kairo

**A production-grade, multi-model coding agent designed for free local models.**

Kairo is a single Python package that gives any project a full agentic coding layer. It runs against free local models (Ollama, vLLM-hosted open weights) or any hosted API, routes work to the right model per turn, fans out to parallel sub-agents, dispatches tool calls in parallel with anti-spam guardrails, reflects on failures and retries, and persists every run so a self-improvement loop can mine past sessions for failure patterns.

## What makes Kairo different

| Feature | Kairo | Generic coding agents |
|---|---|---|
| Multi-provider (OpenAI, Anthropic, OpenRouter, Ollama, GLM/ZAI, XML tool-call) | ✅ | ❌ |
| Multi-model routing per turn | ✅ | ❌ |
| Planner / executor / critic orchestrator | ✅ | ❌ |
| Sub-agent coordination (fan-out, pipeline, tree-search) | ✅ | rare |
| Reflexion-style retry on failure | ✅ | rare |
| Tool-call anti-spam guardrails | ✅ | partial |
| Tool-call parallelism | ✅ | ✅ |
| Context-window compaction | ✅ | ✅ |
| Persistent session replay | ✅ | ✅ |
| Self-improvement analysis | ✅ | ❌ |
| Local-model XML tool-call support | ✅ | rare |
| Prompt-injection filter on tool outputs | ✅ | ❌ |
| MCP (Model Context Protocol) bridge | ✅ | rare |
| Built-in SWE tools (call-graph, imports, signatures) | ✅ | rare |
| Built-in web-design tools (HTML/CSS, dev server) | ✅ | rare |
| Built-in eval harness | ✅ | ❌ |
| Streaming provider support | ✅ | ✅ |
| Built for free local models by default | ✅ | ❌ |

## Quick start

```bash
pip install -e .

# List available models
kairo models

# Run a single message
export ZAI_API_KEY=...
kairo run "Write a hello-world FastAPI app" --workspace .

# Run a task with reflexion-style retries (3 attempts)
kairo task "Fix the bug in src/foo.py" --workspace . --max-attempts 3

# Tree-search a task: try 3 parallel approaches, pick the best
kairo explore "Refactor the auth module" --workspace . --n 3 --strategy first_success

# Interactive REPL
kairo repl --workspace .

# Inspect past runs + get improvement suggestions
kairo runs
kairo improve

# Run an eval suite
kairo eval examples/eval-suites/coding-basics --workspace /tmp/kairo-eval
```

## Architecture

```
kairo/
├── types.py             # Provider-agnostic Message/ToolCall/ToolResult/etc.
├── config.py            # Layered YAML + env config (free-model defaults)
├── errors.py            # Exception hierarchy
├── utils/               # Logging + EventBus
├── tools/
│   ├── base.py          # ToolRegistry + @tool decorator + schema inference
│   ├── guardrails.py    # SpamGuard (per-turn, across-turn, debounce, caps)
│   ├── file_ops.py      # read_file, list_dir, glob_files, write_file, delete_file
│   ├── edit.py          # edit_file, multi_edit (atomic), append_file
│   ├── search.py        # grep (ripgrep), find_symbol
│   ├── shell.py         # shell, run_python (sandboxed)
│   ├── web.py           # web_fetch, web_search (pluggable backend)
│   ├── swe.py           # get_imports, get_importers, get_signature, find_references, get_call_graph
│   ├── web_design.py    # write_html/css, validate_html, extract_outline, preview_html, start_dev_server
│   ├── todo.py          # todo_set/update/list (shared with orchestrator)
│   ├── mcp/             # MCP (Model Context Protocol) bridge — stdio + HTTP transports
│   └── __init__.py      # build_default_registry
├── providers/
│   ├── base.py          # Provider abstract + register_provider
│   ├── openai.py        # OpenAI + base for OpenAI-compatible servers
│   ├── anthropic.py     # Claude (content-block translation)
│   ├── ollama.py        # Local models
│   ├── openrouter.py    # Multi-model gateway
│   ├── glm.py           # ZAI / GLM (with X-Token JWT support)
│   ├── hermes_xml.py    # Local open-weight models via <tool_call> XML
│   └── streaming.py     # SSE streaming + assemble_stream
├── routing/
│   ├── catalog.py       # ModelInfo registry (18+ models pre-loaded)
│   ├── classifier.py    # TaskKind heuristics (plan/code/debug/tests/...)
│   ├── router.py        # Router (cost/capability/context-aware)
│   └── orchestrator.py  # Planner/executor/critic phase coordinator
├── agent/
│   ├── agent.py         # The agent loop
│   ├── dispatcher.py    # Parallel tool execution + guardrail screening
│   ├── context.py       # Token estimation + compaction
│   ├── safety.py        # Injection filter + dangerous-tool confirmation
│   ├── memory.py        # SessionStore (JSON persistence + replay)
│   ├── self_improve.py  # Analyze past runs, emit Suggestions
│   ├── reflexion.py     # Reflexion-style retry on failure
│   └── swarm/           # Sub-agent coordination (fan_out, pipeline, tree_search)
├── eval/
│   └── harness.py       # Task-suite runner + graders (string/file/shell/pytest)
├── repl/
│   └── repl.py          # Interactive Rich-based REPL
└── cli.py               # Click CLI (run/task/explore/eval/repl/models/config/runs/improve)
```

## The agent loop (one turn)

```
                ┌──────────────────────────┐
                │   Orchestrator.begin()   │
                │   → phase + RoutingDecision│
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │  ContextManager.maybe_   │
                │  compact() if over 75%   │
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │  Provider.complete()     │
                │  (router-picked model)   │
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │  Parse response.tool_calls│
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │  For each call:          │
                │   - unknown? → error TR  │
                │   - dangerous? → confirm │
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │  SpamGuard.screen(allowed)│
                │   - per-turn dedupe      │
                │   - across-turn dedupe   │
                │   - per-tool caps        │
                │   - debounce             │
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │  Dispatcher.dispatch()   │
                │  (parallel thread pool)  │
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │  SafetyFilter on outputs │
                │  (injection redaction)   │
                └────────────┬─────────────┘
                             ▼
                ┌──────────────────────────┐
                │  Append ToolResult msgs  │
                │  Orchestrator.advance()  │
                └──────────────────────────┘
```

## Multi-model routing

The router picks a model per turn based on:

1. **TaskKind** (detected from the last user/tool message)
   - `PLAN`, `CODE`, `CODE_REVIEW`, `REFACTOR`, `TESTS`, `DEBUG`,
     `EXPLAIN`, `SUMMARY`, `SEARCH`, `SHELL`, `GENERAL`
2. **Required capabilities** — e.g. `plan` tasks need a `plan`-capable model
3. **Context window** — model must fit current `est_tokens`
4. **Cost ceiling** — `RouterConfig.max_cost_per_m_usd` (optional)
5. **Explicit overrides** — `RouterConfig.overrides[task_kind] = "provider:model"`

Defaults prefer free models (Ollama local) and fall back to cheap hosted models (GLM).

## Sub-agent coordination

Three patterns for parallel work:

```python
from kairo.agent.swarm import fan_out, pipeline, SubTask

# Fan-out: N independent children run in parallel
result = fan_out(
    [SubTask(id=f"t{i}", prompt=f"Write tests for module_{i}") for i in range(5)],
    kairo_cfg, workspace=Path("."), max_workers=4,
)

# Pipeline: chain children so each one's output feeds the next
result = pipeline(
    [SubTask(id="find", prompt="Find the bug"),
     SubTask(id="fix", prompt="Write the fix"),
     SubTask(id="test", prompt="Write tests for the fix")],
    kairo_cfg, workspace=Path("."),
)
```

**Tree-search** explores N approaches in parallel and picks the best:

```python
from kairo.agent.swarm.tree_search import tree_search

result = tree_search(
    [SubTask(id=f"approach_{i}", prompt="Fix the bug") for i in range(5)],
    kairo_cfg, workspace=Path("."),
    strategy="self_consistency",  # or: first_success, critic
)
print(result.chosen.final_text)
```

## Reflexion

When the agent fails a task, instead of giving up, Kairo writes a verbal reflection on *why* it failed and retries with that reflection as additional context. After a few rounds, the agent usually converges on a working solution.

```python
from kairo.agent import reflexion_run, AgentConfig

result = reflexion_run(
    AgentConfig(workspace=Path(".")),
    kairo_cfg,
    "Fix the bug in src/foo.py",
    max_attempts=3,
)
print(f"Succeeded: {result.succeeded} after {result.attempts_used} attempts")
```

CLI equivalent:

```bash
kairo task "Fix the bug in src/foo.py" --max-attempts 3
```

## Anti-spam guardrails

Free open-weight models can be noisier than frontier paid APIs. Kairo's `SpamGuard` catches runaway loops while still letting the model retry legitimate calls. Defaults are permissive:

| Rule | Default | Trip behavior |
|---|---|---|
| `repeat_in_turn` | max 2 identical calls/turn | Block + structured error to model |
| `repeat_across_turns` | max 4 identical calls / 4 turns | Block + "change approach" hint |
| `per_turn_cap` | max 20 calls/turn | Block + "produce final answer" hint |
| `per_tool_cap` | per-tool override | Block + "tool hit its cap" |
| `debounce` | 0s (off by default) | Block + "wait N seconds" |

The guard runs *before* dispatch — blocked calls become `ToolResult` errors so the model can recover on the next turn instead of crashing the loop.

## Providers

| Provider | Auth | Notes |
|---|---|---|
| `openai` | `OPENAI_API_KEY` | Native tool_calls |
| `anthropic` | `ANTHROPIC_API_KEY` | Content-block translation |
| `openrouter` | `OPENROUTER_API_KEY` | OpenAI-compatible |
| `ollama` | none (local) | OpenAI-compatible `/api/chat` |
| `glm` (ZAI) | `ZAI_API_KEY` + `ZAI_TOKEN` | Internal endpoint needs `X-Token` JWT |
| `hermes_xml` | none (local) | Parses `<tool_call>{json}</tool_call>` from text |

Adding a provider = ~150 lines. See `kairo/providers/openai.py` for the canonical example.

## MCP (Model Context Protocol) bridge

Connect any MCP server as an additional tool source:

```python
from kairo.tools.mcp import MCPManager, StdioServerConfig

mgr = MCPManager()
mgr.add("fs", StdioServerConfig(command=["npx", "mcp-server-fs", "/tmp"]))
mgr.add("git", StdioServerConfig(command=["npx", "mcp-server-git"]))
mgr.connect_all()
mgr.register_all(my_registry)
# ... use the registry as usual; MCP tools appear as `mcp_<server>_<tool>` ...
mgr.close_all()
```

Two transports supported: `stdio` (subprocess) and `http` (POST JSON-RPC).

## SWE tools

Built-in code intelligence using Python's stdlib `ast`:

| Tool | What it does |
|---|---|
| `get_imports` | List imports in a Python file |
| `get_importers` | Find files that import a given module |
| `get_signature` | Extract function/method/class signatures |
| `find_references` | Find all references to a symbol (ripgrep) |
| `get_call_graph` | Build a function-level call graph for a directory |

## Web design tools

| Tool | What it does |
|---|---|
| `write_html` | Write an HTML file (with optional boilerplate) |
| `write_css` | Write a CSS file |
| `validate_html` | Basic structural validation (tags balanced, DOCTYPE present) |
| `extract_outline` | Text outline of an HTML file's structure |
| `preview_html` | Render HTML to PNG (Chromium/Playwright when available) |
| `start_dev_server` | Background static-file server |
| `stop_dev_server` | Stop a running dev server |

## Self-improvement loop

Every run is persisted to `~/.kairo/runs/run_<ts>_<tag>_<uuid>.json`. The `kairo improve` command mines recent runs and emits `Suggestion` objects:

```
$ kairo improve
Found 2 suggestion(s):

1. [router_override] Multiple runs hit loop_limit — model may be too weak
   confidence: 70%
   3 runs reached the loop limit without completing. The current model may
   lack the capability for this task kind. Set RouterConfig.overrides to
   route to a stronger model and re-run.
   evidence: 3 run(s)

2. [system_prompt] Some runs consume 5x median tokens
   confidence: 50%
   2 runs used >5x the median token count (4500 tokens). The agent may be
   wandering — add a 'be concise, do not repeat yourself' instruction to
   the system prompt.
   evidence: 2 run(s)
```

Analyzers:
- **Repeated unknown tools** → `TOOL_RENAME` suggestion
- **High guardrail pressure** → `SPAM_GUARD_LOOSEN` or `SYSTEM_PROMPT`
- **Per-tool error rate > 50%** (excluding guardrail blocks) → `TOOL_DESCRIPTION`
- **Multiple `loop_limit` finishes** → `ROUTER_OVERRIDE`
- **5x median token outliers** → `SYSTEM_PROMPT` (be concise)

## Eval harness

Run a benchmark suite of agent tasks with built-in graders:

```
$ kairo eval examples/eval-suites/coding-basics

Suite: coding-basics
  Tasks:     7
  Pass rate: 71.4%
  Avg tokens: 10930
  Avg duration: 4.2s
  Total duration: 29.1s

Per-task results:
  [PASS] write_file  (2.1s)  found
  [FAIL] list_dir  (1.3s)  expected 'hello.txt' not in final text
  [PASS] echo_shell  (1.4s)  matched
  ...
```

Built-in graders: `string_match`, `file_contains`, `file_exists`, `shell_check`, `pytest_check`.

Define your own suite by creating a `tasks.json` (see `examples/eval-suites/coding-basics/tasks.json`).

## Configuration

```yaml
# ~/.kairo/config.yaml
providers:
  openai:
    enabled: true
    api_key_env: OPENAI_API_KEY
    default_model: gpt-4o-mini
  glm:
    enabled: true
    api_key_env: ZAI_API_KEY
    base_url: https://internal-api.z.ai/v1
    default_model: glm-4.6
  ollama:
    enabled: true
    base_url: http://localhost:11434
    default_model: qwen2.5-coder:7b

safety:
  enable_spam_guard: true
  enable_injection_filter: true
  max_turns: 40            # generous for free local models
  max_tool_calls_per_turn: 20

router:
  default_model: ollama:qwen2.5-coder:7b   # prefer free local
  prefer_cheapest: true
  overrides:
    plan: glm:glm-4.6
    code: ollama:qwen2.5-coder:7b

orchestrator:
  enabled: false  # set true for planner/executor/critic mode

context:
  compact_at_fraction: 0.75
  keep_last_turns: 6
```

## Testing

```bash
python -m pytest tests/ -q
```

196+ tests covering: types, config, tools (file/edit/search/shell/web/todo/swe/web_design/mcp), guardrails, providers (translation logic for OpenAI/Anthropic/XML), routing (classifier/catalog/router/orchestrator), context compaction, dispatcher, agent integration (end-to-end with fake providers), memory persistence, self-improvement analysis, reflexion, swarm (fan-out/pipeline/tree-search), eval harness, and streaming.

End-to-end smoke tests against the real GLM API:

```bash
python scripts/smoke_glm.py        # basic agent loop
python scripts/smoke_streaming.py  # streaming
python scripts/smoke_eval.py       # eval suite
```

## License

MIT.
