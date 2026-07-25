"""Configuration for Kairo.

Configuration is layered:
  1. Built-in defaults (see :data:`DEFAULT_CONFIG`).
  2. YAML file pointed at by ``KAIRO_CONFIG`` (or ``~/.kairo/config.yaml``).
  3. Environment variables prefixed with ``KAIRO_`` (highest priority).

We intentionally avoid pydantic-settings here so the import surface stays
tiny and the config object is just a frozen dataclass you can introspect.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

import yaml

from kairo.errors import ConfigError


@dataclass(slots=True)
class ProviderConfig:
    """Per-provider connection config.

    ``api_key_env`` is the name of the env var we read the key from, NOT
    the key itself — this keeps secrets out of serialized config files.
    """

    enabled: bool = False
    base_url: str | None = None
    api_key_env: str | None = None
    default_model: str | None = None
    timeout_s: float = 120.0
    max_retries: int = 3
    extra: dict[str, Any] = field(default_factory=dict)

    def api_key(self) -> str | None:
        if not self.api_key_env:
            return None
        return os.environ.get(self.api_key_env)


@dataclass(slots=True)
class SafetyConfig:
    """Safety / guardrail config.

    Defaults are tuned for free local models — they get more turns
    because they're weaker, the spam guard is permissive, and any tool
    tagged ``dangerous`` still requires confirmation in interactive mode.
    """

    enable_spam_guard: bool = True
    enable_injection_filter: bool = True
    enable_dangerous_confirm: bool = True
    max_turns: int = 40
    max_tool_calls_per_turn: int = 20
    max_repeat_calls: int = 4
    # When True, the agent loop will pause and ask the user before any
    # tool tagged "dangerous" runs. Off by default for non-interactive use.
    interactive_confirm: bool = False


@dataclass(slots=True)
class RouterConfig:
    """Router policy config.

    ``default_model`` is used when nothing matches. ``overrides`` is a
    TaskKind -> "<provider>:<model>" map for force-routing a particular
    task kind to a particular model.

    Defaults prefer free models (Ollama local) when available, falling
    back to GLM (cheap hosted).
    """

    default_model: str = "ollama:qwen2.5-coder:7b"
    # When True the router picks the cheapest model that satisfies the
    # constraints. When False it picks the most capable.
    prefer_cheapest: bool = True
    max_cost_per_m_usd: float | None = None
    overrides: dict[str, str] = field(default_factory=dict)
    # Models we should never route to (e.g. deprecated).
    deny: list[str] = field(default_factory=list)


@dataclass(slots=True)
class OrchestratorConfig:
    """Orchestrator policy config.

    When ``enabled`` is True the agent uses a planner/executor/critic
    pattern: the planner model produces a TODO list, the executor model
    works through it, and the critic model verifies the result.
    """

    enabled: bool = False
    planner_model: str | None = None
    executor_model: str | None = None
    critic_model: str | None = None
    critic_on_every_turn: bool = False
    max_replans: int = 2


@dataclass(slots=True)
class ContextConfig:
    """Context-window management config."""

    # When the conversation exceeds this fraction of the model's context,
    # Kairo triggers compaction (summarize old turns).
    compact_at_fraction: float = 0.75
    # Keep the last N tool turns verbatim during compaction.
    keep_last_turns: int = 6
    # Always keep the first user message + system prompt.
    keep_anchor: bool = True
    # Approximate tokens-per-character for naive estimation when we don't
    # have a tokenizer for the active provider.
    tokens_per_char: float = 0.25


@dataclass(slots=True)
class KairoConfig:
    """Top-level config object."""

    providers: dict[str, ProviderConfig] = field(default_factory=dict)
    safety: SafetyConfig = field(default_factory=SafetyConfig)
    router: RouterConfig = field(default_factory=RouterConfig)
    orchestrator: OrchestratorConfig = field(default_factory=OrchestratorConfig)
    context: ContextConfig = field(default_factory=ContextConfig)
    # Where Kairo persists session logs / memory / replay files.
    workdir: Path = field(default_factory=lambda: Path.home() / ".kairo")
    log_level: str = "INFO"
    # When True, every agent turn is dumped to workdir/runs/<ts>/*.json.
    persist_turns: bool = True

    def provider(self, name: str) -> ProviderConfig:
        cfg = self.providers.get(name)
        if cfg is None:
            raise ConfigError(f"Unknown provider: {name!r}")
        return cfg

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["workdir"] = str(self.workdir)
        return d


# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_CONFIG: KairoConfig = KairoConfig(
    providers={
        "openai": ProviderConfig(
            enabled=True,
            api_key_env="OPENAI_API_KEY",
            default_model="gpt-4o-mini",
        ),
        "anthropic": ProviderConfig(
            enabled=True,
            api_key_env="ANTHROPIC_API_KEY",
            default_model="claude-3-5-sonnet-20241022",
        ),
        "openrouter": ProviderConfig(
            enabled=True,
            api_key_env="OPENROUTER_API_KEY",
            base_url="https://openrouter.ai/api/v1",
            default_model="anthropic/claude-3.5-sonnet",
        ),
        "ollama": ProviderConfig(
            enabled=True,
            base_url="http://localhost:11434",
            default_model="llama3.1:8b",
            timeout_s=300.0,
        ),
        "glm": ProviderConfig(
            enabled=True,
            api_key_env="ZAI_API_KEY",
            base_url="https://api.z.ai/api/paas/v4",
            default_model="glm-4.6",
        ),
        "hermes_xml": ProviderConfig(
            enabled=False,
            base_url="http://localhost:8000",
            default_model="NousResearch/Hermes-2-Pro-Llama-3-8B",
            timeout_s=300.0,
        ),
    },
)


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------

def _merge_dicts(base: dict, override: dict) -> dict:
    """Deep-merge override into base. Override wins on conflicts."""
    out = dict(base)
    for k, v in override.items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _merge_dicts(out[k], v)
        else:
            out[k] = v
    return out


def _dataclass_from_dict(cls, data: dict):
    """Best-effort dataclass construction from a (possibly nested) dict."""
    if not data:
        return cls()
    import dataclasses as dc
    fields_map = {f.name: f for f in dc.fields(cls)}
    kwargs: dict[str, Any] = {}
    for k, v in data.items():
        if k not in fields_map:
            continue
        f = fields_map[k]
        if dc.is_dataclass(f.type) and isinstance(v, dict):
            kwargs[k] = _dataclass_from_dict(f.type, v)
        else:
            kwargs[k] = v
    return cls(**kwargs)


def _config_from_dict(data: dict) -> KairoConfig:
    # Start from defaults and merge so partial files keep defaults.
    base = DEFAULT_CONFIG.to_dict()
    # workdir was stringified by to_dict; convert back.
    base["workdir"] = Path(base["workdir"])
    merged = _merge_dicts(base, data)
    if isinstance(merged.get("workdir"), str):
        merged["workdir"] = Path(merged["workdir"])
    # Rebuild providers dict explicitly.
    provs: dict[str, ProviderConfig] = {}
    for name, pdict in merged.get("providers", {}).items():
        provs[name] = _dataclass_from_dict(ProviderConfig, pdict or {})
    merged["providers"] = provs
    safety = _dataclass_from_dict(SafetyConfig, merged.get("safety", {}))
    router = _dataclass_from_dict(RouterConfig, merged.get("router", {}))
    orch = _dataclass_from_dict(OrchestratorConfig, merged.get("orchestrator", {}))
    ctx = _dataclass_from_dict(ContextConfig, merged.get("context", {}))
    return KairoConfig(
        providers=provs,
        safety=safety,
        router=router,
        orchestrator=orch,
        context=ctx,
        workdir=merged["workdir"],
        log_level=merged.get("log_level", "INFO"),
        persist_turns=merged.get("persist_turns", True),
    )


def load_config(path: str | os.PathLike | None = None) -> KairoConfig:
    """Load config from YAML file, with env-var overrides.

    Search order:
      * explicit ``path`` argument (highest priority)
      * ``$KAIRO_CONFIG`` env var
      * ``~/.kairo/config.yaml``
      * built-in :data:`DEFAULT_CONFIG`
    """
    candidates: list[Path] = []
    if path is not None:
        candidates.append(Path(path))
    env_path = os.environ.get("KAIRO_CONFIG")
    if env_path:
        candidates.append(Path(env_path))
    candidates.append(Path.home() / ".kairo" / "config.yaml")

    data: dict[str, Any] = {}
    for p in candidates:
        if p and p.exists() and p.is_file():
            with open(p) as f:
                loaded = yaml.safe_load(f) or {}
            if not isinstance(loaded, dict):
                raise ConfigError(f"Config file {p} did not contain a mapping")
            data = _merge_dicts(data, loaded)
            break

    cfg = _config_from_dict(data) if data else DEFAULT_CONFIG
    # Env overrides.
    if v := os.environ.get("KAIRO_LOG_LEVEL"):
        cfg.log_level = v
    if v := os.environ.get("KAIRO_WORKDIR"):
        cfg.workdir = Path(v)
    if v := os.environ.get("KAIRO_MAX_TURNS"):
        try:
            cfg.safety.max_turns = int(v)
        except ValueError:
            raise ConfigError(f"KAIRO_MAX_TURNS={v!r} is not an int")
    return cfg


def save_config(cfg: KairoConfig, path: str | os.PathLike) -> None:
    """Persist a config to disk as YAML."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w") as f:
        yaml.safe_dump(cfg.to_dict(), f, sort_keys=False)
