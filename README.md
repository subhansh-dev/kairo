# kairo

**A production-grade agentic LLM framework built for edge and free local models.**

Kairo is a single Python package that gives any project a full agentic layer: multi-model routing, sub-agent coordination, structured output, MCP/A2A protocol bridging, multi-type memory, code-sandbox execution, eval harness, observability dashboard, and many classic agent reasoning patterns (ReAct, ReWOO, Plan-and-Execute, Tree-of-Thoughts, Self-Refine, Reflexion). It runs against free local models (Ollama, vLLM-hosted open weights) or any hosted API.

## What makes Kairo different

Built specifically for **free + edge LLMs** — small/old models that other frameworks don't optimize for:

| Feature | Kairo | Generic frameworks |
|---|---|---|
| Multi-provider (OpenAI, Anthropic, OpenRouter, Ollama, GLM/ZAI, XML tool-call) | ✅ | partial |
| Multi-model routing per turn | ✅ | rare |
| **Cascade routing** (cheap→strong escalation) | ✅ | rare |
| Planner / executor / critic orchestrator | ✅ | rare |
| **State graph DAG** (LangGraph-style) | ✅ | rare |
| Sub-agent coordination (fan-out, pipeline, tree-search) | ✅ | rare |
| **Multi-agent message bus** (in-process) | ✅ | rare |
| **A2A protocol** (cross-process, open standard) | ✅ | rare |
| Reflexion-style retry on failure | ✅ | rare |
| **Tree of Thoughts** + **Self-Refine** | ✅ | rare |
| **ReAct / ReWOO / Plan-and-Execute** patterns | ✅ | rare |
| Tool-call anti-spam guardrails (tuned for noisy local models) | ✅ | partial |
| Tool-call parallelism | ✅ | ✅ |
| Context-window compaction | ✅ | ✅ |
| Persistent session replay | ✅ | ✅ |
| **Multi-type memory** (episodic + semantic + procedural) | ✅ | rare |
| **Persistent learning graph** (cross-run hints) | ✅ | rare |
| Self-improvement analysis (mines past runs) | ✅ | ❌ |
| **Structured output** with lenient JSON parsing + repair | ✅ | partial |
| **Tool-call grammar** for tiny models | ✅ | rare |
| **Code sandbox** (smolagents-style Python interpreter) | ✅ | rare |
| **Agent skills** (SKILL.md loader) | ✅ | rare |
| Local-model XML tool-call support | ✅ | rare |
| Prompt-injection filter on tool outputs | ✅ | ❌ |
| **Provider failover** (retry on different model) | ✅ | rare |
| MCP (Model Context Protocol) bridge | ✅ | rare |
| SWE tools (call-graph, imports, signatures) | ✅ | rare |
| Web-design tools (HTML/CSS, dev server, screenshot) | ✅ | rare |
| **Embeddings RAG** (zero-dependency, pluggable) | ✅ | rare |
| **Code-graph RAG** (TF-IDF, camelCase-aware) | ✅ | rare |
| **Browser automation** (agent-browser CLI wrapper) | ✅ | rare |
| **Tracing** (OpenTelemetry-style spans) | ✅ | rare |
| **Observability dashboard** (HTML, read-only) | ✅ | rare |
| Built-in eval harness | ✅ | rare |
| Streaming provider support | ✅ | ✅ |
| **389 tests passing** | ✅ | varies |

## Quick start

```bash
pip install -e .

# List available models
kairo models

# Run a single message
export ZAI_API_KEY=...
kairo run "Write a hello-world FastAPI app" --workspace .

# Run a task with reflexion-style retries
kairo task "Fix the bug in src/foo.py" --workspace . --max-attempts 3

# Tree-search: try 3 parallel approaches, pick the best
kairo explore "Refactor the auth module" --workspace . --n 3 --strategy first_success

# Run an eval suite
kairo eval examples/eval-suites/coding-basics --workspace /tmp/kairo-eval

# Inspect past runs + get improvement suggestions
kairo runs
kairo improve

# Show the active persona / system prompt
kairo soul --persona examples/soul.md

# Show learning-graph stats
kairo learning
```

## Architecture

```
kairo/
├── types.py             # Provider-agnostic Message/ToolCall/ToolResult/etc.
├── config.py            # Layered YAML + env config (free-model defaults)
├── errors.py            # Exception hierarchy
├── tracing.py           # OpenTelemetry-style span() + SpanCollector
├── rag.py               # Embeddings + VectorStore + RagRetriever (zero-dep)
├── observability.py     # Read-only HTML dashboard over past runs
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
│   ├── web_design.py    # write_html/css, validate_html, extract_outline, preview_html, dev_server
│   ├── code_rag.py      # TF-IDF code search (camelCase + snake_case aware)
│   ├── browser.py       # agent-browser CLI wrapper (navigate, click, type, snapshot)
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
│   ├── memory_types.py  # Episodic + Semantic + Procedural memory
│   ├── learning.py      # Persistent learning graph (cross-run hints)
│   ├── self_improve.py  # Analyze past runs, emit Suggestions
│   ├── reflexion.py     # Reflexion-style retry on failure
│   ├── persona.py       # soul.md system-prompt loader
│   ├── failover.py      # Provider failover (retry on different model)
│   ├── cascade.py       # Cascade router (cheap→strong escalation)
│   ├── graph/           # LangGraph-style StateGraph with checkpoints
│   ├── patterns/        # ReAct, ReWOO, Plan-and-Execute
│   ├── tot.py           # Tree of Thoughts + Self-Refine
│   ├── structured.py    # Structured output with lenient JSON + schema validation
│   ├── tool_grammar.py  # Small-model tool-call extractor (XML/markdown/bare JSON)
│   ├── code_sandbox.py  # smolagents-style Python interpreter
│   ├── a2a.py           # Agent2Agent open protocol (HTTP server + client)
│   ├── coord.py         # In-process multi-agent message bus
│   ├── skills.py        # SKILL.md-format agent skills loader
│   └── swarm/           # Sub-agent coordination (fan_out, pipeline, tree_search)
├── eval/
│   └── harness.py       # Task-suite runner + 5 graders
├── repl/
│   └── repl.py          # Interactive Rich-based REPL
└── cli.py               # 12 CLI commands
```

## Classic agent reasoning patterns

Kairo implements the canonical patterns from the agent literature:

| Pattern | Module | Description |
|---|---|---|
| **ReAct** | `agent.patterns.react_run` | Think → Act → Observe loop (Yao et al. 2022) |
| **ReWOO** | `agent.patterns.rewoo_run` | Plan-once-then-execute (Xu et al. 2023) |
| **Plan-and-Execute** | `agent.patterns.plan_and_execute_run` | Planner → executor → replanner |
| **Reflexion** | `agent.reflexion` | Verbal-reinforcement retry (Shinn et al. 2023) |
| **Tree of Thoughts** | `agent.tot.tree_of_thoughts` | Branching reasoning search (Yao et al. 2023) |
| **Self-Refine** | `agent.tot.self_refine` | Iterative critique-and-refine (Madaan et al. 2023) |
| **Cascade** | `agent.cascade.CascadeRouter` | Cheap→strong model escalation (speculative cascades) |
| **Planner/Executor/Critic** | `routing.orchestrator` | Phase-coordinated multi-model loop |

## Multi-model cascade routing

```python
from kairo.agent import CascadeRouter, CascadeConfig, build_cascade_from_catalog
from kairo.routing import default_catalog
from kairo.config import DEFAULT_CONFIG

# Build a cascade chain: try cheapest model first, escalate on low confidence.
chain = build_cascade_from_catalog(
    DEFAULT_CONFIG, default_catalog(),
    required_caps=("code",), max_chain=3,
)
router = CascadeRouter(DEFAULT_CONFIG, default_catalog(), chain,
                       cfg=CascadeConfig(strategy="confidence", confidence_threshold=0.5))
result = router.complete(messages, tools=[])
print(f"Winner: {result.winner}, confidence: {result.confidence:.2f}")
```

## Multi-type memory

```python
from kairo.agent import AgentMemory

mem = AgentMemory.load(Path("~/.kairo").expanduser())
mem.episodic.record("tool_call", "called read_file", path="foo.py")
mem.semantic.add("foo.py", "contains_function", "bar")
mem.procedural.add(ProceduralSkill(
    id="s1", name="fix_bug",
    description="Fix a bug in foo.py",
    trigger="bug in foo.py",
    steps=["read foo.py", "locate the bug", "edit_file"],
))
context = mem.recall("bug in foo.py")
# → "Recent events: ...\nRelevant facts: ...\nApplicable skills: ..."
```

## State graph (LangGraph-style DAG)

```python
from kairo.agent import StateGraph, State, END

g = StateGraph()
g.add_node("plan", lambda s: {"plan": "..."})
g.add_node("execute", lambda s: {"result": "..."})
g.add_node("review", lambda s: {"review": "..."})
g.add_edge("plan", "execute")
g.add_conditional_edge("execute", lambda s: "review" if s.data.get("needs_review") else END)
g.add_edge("review", "execute")
compiled = g.compile()
final_state = compiled.run(State())
```

## Structured output (with repair)

```python
from kairo.agent import StructuredRunner

runner = StructuredRunner(provider, model="glm-4.6")
schema = {
    "type": "object",
    "properties": {"name": {"type": "string"}, "age": {"type": "integer"}},
    "required": ["name"],
}
result = runner.complete(messages, schema=schema)
# result.value is a validated dict; result.errors is a list of ValidationError
# result.repaired is True if a repair attempt was needed
```

## Tool-call grammar for tiny models

```python
from kairo.agent.tool_grammar import extract_tool_calls_grammar, render_tools_compact

# For small models: render tools compactly in the system prompt.
compact = render_tools_compact(registry)

# After model output, extract tool calls with multi-format lenient parsing.
result = extract_tool_calls_grammar(model_text, registry)
for call in result.calls:
    print(call.name, call.arguments)
for err in result.errors:
    print("parse error:", err)
```

## A2A (Agent2Agent) protocol

```python
from kairo.agent import A2AServer, A2AClient, AgentCard, A2AMessage

# Host a Kairo agent over HTTP for cross-framework interop.
server = A2AServer(host="127.0.0.1", port=8080)
server.register(
    AgentCard(name="kairo-coder", description="Kairo coding agent", url="",
              capabilities=["code", "tools"]),
    handler=lambda msg: A2AMessage(sender="kairo-coder", recipient=msg.sender,
                                    content=agent.run(msg.content)),
)
server.start()
# Other agents (Kairo or not) can now POST to http://localhost:8080/agents/kairo-coder
```

## Anti-spam guardrails (tuned for free local models)

| Rule | Default | Trip behavior |
|---|---|---|
| `repeat_in_turn` | max 2 identical calls/turn | Block + structured error to model |
| `repeat_across_turns` | max 4 identical calls / 4 turns | Block + "change approach" hint |
| `per_turn_cap` | max 20 calls/turn | Block + "produce final answer" hint |
| `per_tool_cap` | per-tool override | Block + "tool hit its cap" |
| `debounce` | 0s (off by default) | Block + "wait N seconds" |

## Providers

| Provider | Auth | Notes |
|---|---|---|
| `openai` | `OPENAI_API_KEY` | Native tool_calls |
| `anthropic` | `ANTHROPIC_API_KEY` | Content-block translation |
| `openrouter` | `OPENROUTER_API_KEY` | OpenAI-compatible |
| `ollama` | none (local) | OpenAI-compatible `/api/chat` — **free** |
| `glm` (ZAI) | `ZAI_API_KEY` + `ZAI_TOKEN` | Internal endpoint needs `X-Token` JWT — **free** |
| `hermes_xml` | none (local) | Parses `<tool_call>{json}</tool_call>` from text — **free** |

## Testing

```bash
python -m pytest tests/ -q
```

**389 tests** covering: types, config, all tool bundles, guardrails, all provider translators (OpenAI/Anthropic/XML), routing, context compaction, dispatcher, agent integration, memory (all 3 types), self-improvement, reflexion, swarm (fan-out/pipeline/tree-search), eval harness, streaming, state graph, structured output, cascade, code sandbox, A2A, tool grammar, ToT/self-refine, skills, RAG, observability, and tracing.

End-to-end smoke tests against the real GLM API:

```bash
python scripts/smoke_glm.py             # basic agent loop
python scripts/smoke_streaming.py       # streaming
python scripts/smoke_eval.py            # eval suite (71% pass on coding-basics)
python scripts/smoke_persona_learning.py # persona + learning graph
python scripts/smoke_swe.py             # SWE tools (code_search + signatures + refs)
python scripts/smoke_comprehensive.py   # all major features at once
```

## Configuration

```yaml
# ~/.kairo/config.yaml
providers:
  ollama:
    enabled: true
    base_url: http://localhost:11434
    default_model: qwen2.5-coder:7b
  glm:
    enabled: true
    api_key_env: ZAI_API_KEY
    base_url: https://internal-api.z.ai/v1
    default_model: glm-4.6

safety:
  enable_spam_guard: true
  max_turns: 40            # generous for free local models
  max_tool_calls_per_turn: 20

router:
  default_model: ollama:qwen2.5-coder:7b   # prefer free local
  prefer_cheapest: true

orchestrator:
  enabled: false  # set true for planner/executor/critic mode

context:
  compact_at_fraction: 0.75
  keep_last_turns: 6
```

## License

MIT.
