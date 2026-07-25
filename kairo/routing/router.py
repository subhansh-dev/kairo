"""Multi-model router.

The router picks the best :class:`ModelInfo` for the next agent step
based on:
  * The detected :class:`TaskKind` for the current turn.
  * The available providers (only ones with API keys configured).
  * The current context-window requirement (sum of message tokens).
  * Cost / latency preferences from :class:`RouterConfig`.

The router is *pure* — given the same inputs it returns the same
decision. The agent loop is responsible for actually invoking the
chosen provider.
"""

from __future__ import annotations

from dataclasses import dataclass

from kairo.config import KairoConfig, RouterConfig
from kairo.errors import RouterError
from kairo.routing.catalog import ModelCatalog
from kairo.routing.classifier import classify_task
from kairo.types import Message, RoutingDecision, TaskKind
from kairo.utils import get_logger

log = get_logger("routing.router")


# Map TaskKind -> capability tags the model must have.
_TASK_CAPS: dict[TaskKind, tuple[str, ...]] = {
    TaskKind.PLAN: ("plan",),
    TaskKind.CODE: ("code",),
    TaskKind.CODE_REVIEW: ("code",),
    TaskKind.REFACTOR: ("code",),
    TaskKind.TESTS: ("code",),
    TaskKind.DEBUG: ("code",),
    TaskKind.EXPLAIN: (),  # any model
    TaskKind.SUMMARY: (),  # any model — router prefers cheapest
    TaskKind.SEARCH: ("tools",),  # need tool calling
    TaskKind.SHELL: ("tools",),  # need tool calling
    TaskKind.GENERAL: (),
}


@dataclass(slots=True)
class RouterContext:
    """Inputs the router needs to make a decision."""

    messages: list[Message]
    needs_tools: bool = False
    # Estimated tokens already in the conversation.
    est_tokens: int = 0
    # Optional: tag this decision with a phase name (planner/executor/critic).
    phase: str | None = None


class Router:
    """Stateful router that picks a model per turn.

    Construction is cheap — the router holds a reference to the catalog
    and config but no other state. The agent loop calls :meth:`pick`
    once per turn.
    """

    def __init__(self, catalog: ModelCatalog, cfg: KairoConfig) -> None:
        self.catalog = catalog
        self.cfg = cfg
        self.rcfg: RouterConfig = cfg.router

    # -- public API ----------------------------------------------------

    def pick(self, ctx: RouterContext) -> RoutingDecision:
        kind = classify_task(ctx.messages)
        return self.pick_for_kind(kind, ctx)

    def pick_for_kind(self, kind: TaskKind, ctx: RouterContext) -> RoutingDecision:
        # 1. Explicit override always wins.
        override = self.rcfg.overrides.get(kind.value)
        if override and override not in self.rcfg.deny:
            try:
                info = self.catalog.get_by_key(override)
                return RoutingDecision(
                    model=info,
                    reason=f"override for task={kind.value}",
                    tags=("override", kind.value),
                )
            except RouterError:
                log.warning("router override %r not in catalog; ignoring", override)

        # 2. Filter catalog by hard constraints.
        candidates = list(self.catalog.all())
        required_caps = set(_TASK_CAPS.get(kind, ()))
        if ctx.needs_tools:
            required_caps.add("tools")
        # Filter by provider config availability (must have api key / be enabled).
        # We don't actually call the API here — we just check the config.
        valid_providers = {
            name for name, pcfg in self.cfg.providers.items() if pcfg.enabled
        }
        valid_providers |= {"ollama", "hermes_xml"}  # local providers don't need keys
        # But only keep local providers if their config is enabled.
        valid_providers = {
            name for name in valid_providers
            if name in self.cfg.providers and self.cfg.providers[name].enabled
        }

        filtered: list = []
        for m in candidates:
            if m.provider not in valid_providers:
                continue
            if f"{m.provider}:{m.name}" in self.rcfg.deny:
                continue
            if required_caps and not required_caps.issubset(set(m.capabilities)):
                continue
            if m.context < ctx.est_tokens:
                continue
            if self.rcfg.max_cost_per_m_usd is not None and m.cost_in_per_m > self.rcfg.max_cost_per_m_usd:
                continue
            filtered.append(m)

        if not filtered:
            # Fall back to default model if it satisfies the constraints.
            try:
                default_info = self.catalog.get_by_key(self.rcfg.default_model)
                return RoutingDecision(
                    model=default_info,
                    reason=f"no candidates matched; falling back to default",
                    tags=("fallback", kind.value),
                )
            except RouterError as exc:
                raise RouterError(
                    f"no model matches task={kind.value} required_caps={required_caps} "
                    f"est_tokens={ctx.est_tokens}; default_model={self.rcfg.default_model!r} "
                    f"also unavailable"
                ) from exc

        # 3. Rank by preference.
        if self.rcfg.prefer_cheapest:
            filtered.sort(key=lambda m: (m.cost_in_per_m + m.cost_out_per_m, -m.tps))
            reason = "cheapest capable model"
        else:
            # Most capable: highest tps among models with most capabilities.
            filtered.sort(
                key=lambda m: (-len(m.capabilities), -m.tps, m.cost_in_per_m + m.cost_out_per_m)
            )
            reason = "most capable model"

        chosen = filtered[0]
        return RoutingDecision(
            model=chosen,
            reason=f"{reason} for task={kind.value} ({len(filtered)} candidates)",
            tags=(kind.value,),
        )

    # -- convenience ---------------------------------------------------

    def pick_phase(self, phase: str, ctx: RouterContext) -> RoutingDecision:
        """Pick for a named orchestrator phase (planner/executor/critic).

        If ``RouterConfig.overrides`` has an entry for the phase name it
        is used; otherwise we map phase -> TaskKind and pick normally.
        """
        override = self.rcfg.overrides.get(phase)
        if override and override not in self.rcfg.deny:
            try:
                info = self.catalog.get_by_key(override)
                return RoutingDecision(
                    model=info,
                    reason=f"override for phase={phase}",
                    tags=("override", phase),
                )
            except RouterError:
                pass
        kind_map = {
            "planner": TaskKind.PLAN,
            "executor": TaskKind.CODE,
            "critic": TaskKind.CODE_REVIEW,
        }
        kind = kind_map.get(phase, TaskKind.GENERAL)
        ctx_phase = RouterContext(
            messages=ctx.messages,
            needs_tools=ctx.needs_tools,
            est_tokens=ctx.est_tokens,
            phase=phase,
        )
        return self.pick_for_kind(kind, ctx_phase)
