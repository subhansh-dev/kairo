"""Kairo — a multi-model coding agent.

Kairo is a production-grade agentic coding layer designed to run against
free local models (Ollama, vLLM-hosted open weights) or any hosted API.

Capabilities:
  * Multi-provider backends (OpenAI, Anthropic, OpenRouter, Ollama,
    GLM/ZAI, plus an XML tool-call adapter for any model that emits
    ``<tool_call>{...}</tool_call>`` tags).
  * A multi-model *router* that picks the right model per step based on
    task type, context size, cost budget, and capability tags.
  * A multi-model *orchestrator* that can run planner / executor / critic
    phases against different models in the same loop.
  * Sub-agent coordination — fan out subtasks to parallel Kairo agents.
  * MCP (Model Context Protocol) bridge — connect external MCP servers
    as additional tool sources.
  * A tool-call anti-spam guardrail layer (debounce, dedupe, rate-limit,
    per-tool call budgets, schema validation) so tool-call spam from a
    weak model never escalates into a runaway loop.
  * First-class file ops / shell / edit / grep / glob / web / code-exec
    / SWE / web-design tools, with safe-by-default sandboxes.
  * Context-window management with compaction + summarization.
  * A safety layer: token budgets, loop limits, prompt-injection defense,
    and an allowlist / denylist for tool arguments.
  * Persistent session replay and a self-improvement analyzer that mines
    past runs to suggest fixes (router overrides, system-prompt tweaks,
    tool description rewrites, etc.).
"""

from kairo._version import __version__
from kairo.config import KairoConfig, load_config
from kairo.rag import KeywordOverlapEmbeddings, RagRetriever, VectorStore
from kairo.types import (
    Message,
    Role,
    ToolCall,
    ToolResult,
    ProviderName,
    ProviderResponse,
)

__all__ = [
    "__version__",
    "KairoConfig",
    "load_config",
    "Message",
    "Role",
    "ToolCall",
    "ToolResult",
    "ProviderName",
    "ProviderResponse",
    # RAG
    "KeywordOverlapEmbeddings",
    "VectorStore",
    "RagRetriever",
]
