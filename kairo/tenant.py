"""Multi-tenant isolation — per-user workspaces, memory, budgets, learning.

When Kairo is deployed as a service (e.g. behind a web API), multiple
users share the same Kairo instance. This module provides per-user
isolation so user A can't see user B's workspace, memory, learning
graph, or budget usage.

A :class:`Tenant` is identified by a unique ``user_id`` string. Each
tenant gets:
  * A private workspace directory under ``workdir/tenants/<user_id>/workspace``
  * A private memory store (episodic + semantic + procedural)
  * A private learning graph
  * A private budget scope (``user:<user_id>``)
  * A private session store (run history)

The :class:`TenantManager` creates and caches tenants, and provides
factory methods for building per-tenant agents.

Usage::

    from kairo.tenant import TenantManager

    mgr = TenantManager(workdir=Path("~/.kairo").expanduser())
    tenant = mgr.get_or_create("user-alice")
    agent = tenant.build_agent(kairo_cfg, system_prompt="You are Alice's agent.")
    result = agent.run("Fix the bug")

Tenants are cheap to create (just directory setup) and cached for the
process lifetime.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from kairo.utils import get_logger

log = get_logger("tenant")


@dataclass(slots=True)
class Tenant:
    """A single tenant's configuration + state.

    Each tenant has isolated:
      * workspace (file operations are sandboxed to this directory)
      * memory (episodic + semantic + procedural)
      * learning graph
      * session store (run history)
      * budget scope
    """

    user_id: str
    base_dir: Path
    workspace: Path = field(init=False)
    memory_dir: Path = field(init=False)
    runs_dir: Path = field(init=False)
    learning_path: Path = field(init=False)
    budget_scope: str = field(init=False)

    def __post_init__(self) -> None:
        self.workspace = self.base_dir / "workspace"
        self.memory_dir = self.base_dir / "memory"
        self.runs_dir = self.base_dir / "runs"
        self.learning_path = self.base_dir / "learning_graph.json"
        self.budget_scope = f"user:{self.user_id}"
        # Ensure dirs exist.
        self.workspace.mkdir(parents=True, exist_ok=True)
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self.runs_dir.mkdir(parents=True, exist_ok=True)

    def build_agent(
        self,
        kairo_cfg: "KairoConfig",
        *,
        system_prompt: str = "",
        max_turns: int | None = None,
        persona_path: Path | None = None,
    ) -> "Agent":
        """Build an Agent configured for this tenant.

        The agent's workspace, learning graph, and session store are all
        scoped to this tenant's directories. The budget scope is set to
        ``user:<user_id>`` so budget limits apply per-user.
        """
        import copy
        from kairo.agent import Agent, AgentConfig
        cfg = copy.deepcopy(kairo_cfg)
        # Override workdir so SessionStore + LearningGraph use tenant dirs.
        cfg.workdir = self.base_dir
        cfg.persist_turns = True
        # Enable budget enforcement for this tenant.
        cfg.safety.enable_budget_enforcement = True
        agent = Agent(cfg, AgentConfig(
            workspace=self.workspace,
            system_prompt=system_prompt,
            max_turns=max_turns,
            persona_path=persona_path,
        ))
        # Override the budget scope to use the tenant's user-scoped key.
        agent._budget_scope = self.budget_scope
        return agent

    def build_async_agent(
        self,
        kairo_cfg: "KairoConfig",
        *,
        system_prompt: str = "",
        max_turns: int | None = None,
    ) -> "AsyncAgent":
        """Build an AsyncAgent configured for this tenant."""
        import copy
        from kairo.agent.async_agent import AsyncAgent
        from kairo.agent import AgentConfig
        cfg = copy.deepcopy(kairo_cfg)
        cfg.workdir = self.base_dir
        cfg.persist_turns = True
        cfg.safety.enable_budget_enforcement = True
        agent = AsyncAgent(cfg, AgentConfig(
            workspace=self.workspace,
            system_prompt=system_prompt,
            max_turns=max_turns,
        ))
        agent._budget_scope = self.budget_scope
        return agent

    def get_memory(self) -> "AgentMemory":
        """Load the tenant's multi-type memory."""
        from kairo.agent.memory_types import AgentMemory
        return AgentMemory.load(self.base_dir)

    def get_learning_graph(self) -> "LearningGraph":
        """Load the tenant's learning graph."""
        from kairo.agent.learning import LearningGraph
        return LearningGraph.load(self.base_dir)

    def get_session_store(self) -> "SessionStore":
        """Get the tenant's session store for run history."""
        from kairo.agent.memory import SessionStore
        store = SessionStore(self.base_dir)
        return store

    def set_budget_limit(self, limit: "BudgetLimit") -> None:
        """Set a budget limit for this tenant."""
        from kairo.agent.budget_enforcer import get_global_enforcer
        enforcer = get_global_enforcer()
        enforcer.set_limit(self.budget_scope, limit)

    def get_usage(self) -> "BudgetUsage":
        """Get this tenant's current budget usage."""
        from kairo.agent.budget_enforcer import get_global_enforcer
        enforcer = get_global_enforcer()
        return enforcer.get_usage(self.budget_scope)


class TenantManager:
    """Creates and caches :class:`Tenant` objects.

    Each tenant's data lives under ``workdir/tenants/<user_id>/``.
    The manager caches tenants for the process lifetime — call
    :meth:`evict` to remove a tenant from the cache (the data on disk
    is preserved).
    """

    def __init__(self, workdir: Path | str) -> None:
        self.workdir = Path(workdir)
        self.tenants_dir = self.workdir / "tenants"
        self.tenants_dir.mkdir(parents=True, exist_ok=True)
        self._cache: dict[str, Tenant] = {}
        self._lock = threading.RLock()

    def get_or_create(self, user_id: str) -> Tenant:
        """Get an existing tenant or create a new one.

        ``user_id`` is sanitized to a filesystem-safe name.
        """
        safe_id = self._sanitize_user_id(user_id)
        with self._lock:
            if safe_id in self._cache:
                return self._cache[safe_id]
            tenant = Tenant(
                user_id=safe_id,
                base_dir=self.tenants_dir / safe_id,
            )
            self._cache[safe_id] = tenant
            log.info("created tenant %r at %s", safe_id, tenant.base_dir)
            return tenant

    def evict(self, user_id: str) -> bool:
        """Remove a tenant from the cache (data on disk is preserved)."""
        safe_id = self._sanitize_user_id(user_id)
        with self._lock:
            return self._cache.pop(safe_id, None) is not None

    def delete(self, user_id: str) -> bool:
        """Delete a tenant's data permanently. Use with caution."""
        import shutil
        safe_id = self._sanitize_user_id(user_id)
        with self._lock:
            self._cache.pop(safe_id, None)
            tenant_dir = self.tenants_dir / safe_id
            if tenant_dir.exists():
                shutil.rmtree(tenant_dir)
                log.info("deleted tenant %r", safe_id)
                return True
            return False

    def list_tenants(self) -> list[str]:
        """List all tenant user_ids that have directories on disk."""
        return sorted(
            p.name for p in self.tenants_dir.iterdir()
            if p.is_dir() and (p / "workspace").is_dir()
        )

    def _sanitize_user_id(self, user_id: str) -> str:
        """Sanitize a user_id to be filesystem-safe.

        Allows alphanumeric + dash + underscore. Everything else is
        replaced with underscore.
        """
        import re
        safe = re.sub(r"[^a-zA-Z0-9_\-]", "_", user_id)
        # Collapse multiple underscores.
        safe = re.sub(r"_+", "_", safe)
        # Strip leading/trailing underscores.
        return safe.strip("_") or "anonymous"
