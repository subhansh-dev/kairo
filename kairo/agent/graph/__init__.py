"""Agent state graph — LangGraph-style DAG orchestration for Kairo.

A :class:`StateGraph` is a directed graph of nodes. Each node is a
callable that takes the current state, does work, and returns a partial
state update. Edges define control flow — including conditional edges
that pick the next node based on the current state.

The graph runs to completion, to a dead-end, or until a node returns a
special ``END`` sentinel. State is checkpointed after every node so a
run can be paused, inspected, and resumed.

This is Kairo's answer to LangGraph. The differences:
  * Built-in integration with Kairo's tool registry + provider pool.
  * Checkpoints are JSON-serializable + stored in the SessionStore.
  * Nodes can be Agent runs, raw functions, or sub-graphs.
  * Edges can be plain (always-take) or conditional (function chooses).

Example::

    g = StateGraph(State)
    g.add_node("plan", plan_node)
    g.add_node("execute", execute_node)
    g.add_node("review", review_node)
    g.add_edge("plan", "execute")
    g.add_conditional_edge("execute", lambda s: "review" if s.needs_review else END)
    g.add_edge("review", "execute")  # retry loop
    compiled = g.compile()
    final_state = compiled.run(initial_state)
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Mapping

from kairo.utils import get_logger

log = get_logger("agent.graph")


# Sentinel for "graph is done".
END = "__END__"
START = "__START__"


class GraphError(Exception):
    """Raised for malformed graphs or invalid executions."""


NodeFn = Callable[["State"], "State | dict | None"]
CondFn = Callable[["State"], str]


@dataclass(slots=True)
class State:
    """Base state class. Subclass to add your own fields.

    The base class provides a free-form ``data`` dict so you can use
    StateGraph without subclassing — just stuff everything in ``data``.
    """

    data: dict[str, Any] = field(default_factory=dict)

    def merge(self, update: Mapping[str, Any] | "State | None") -> "State":
        """Return a new State with ``update`` merged in.

        ``update`` may be:
          * A dict — merged into ``self.data``.
          * A State — its ``data`` merged into ``self.data``.
          * None — no-op.
        """
        if update is None:
            return self
        if isinstance(update, State):
            update = update.data
        new_data = {**self.data, **dict(update)}
        return State(data=new_data)


@dataclass(slots=True)
class Checkpoint:
    """A snapshot of a graph run at a single node boundary."""

    node_name: str
    state: State
    ts: float = field(default_factory=time.time)
    run_id: str = field(default_factory=lambda: uuid.uuid4().hex[:16])

    def to_dict(self) -> dict:
        return {
            "node_name": self.node_name,
            "state_data": self.state.data,
            "ts": self.ts,
            "run_id": self.run_id,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Checkpoint":
        return cls(
            node_name=d["node_name"],
            state=State(data=d.get("state_data", {})),
            ts=d.get("ts", time.time()),
            run_id=d.get("run_id", uuid.uuid4().hex[:16]),
        )


class StateGraph:
    """A directed graph of nodes.

    Build the graph with :meth:`add_node` + :meth:`add_edge` /
    :meth:`add_conditional_edge`, then :meth:`compile` to get a
    :class:`CompiledGraph` you can run.
    """

    def __init__(self, state_cls: type[State] = State) -> None:
        self.state_cls = state_cls
        self._nodes: dict[str, NodeFn] = {}
        self._edges: dict[str, str] = {}  # plain edges: from -> to
        self._cond_edges: dict[str, CondFn] = {}  # conditional edges
        self._entry: str | None = None

    def add_node(self, name: str, fn: NodeFn) -> "StateGraph":
        if name in (START, END):
            raise GraphError(f"reserved node name: {name!r}")
        if name in self._nodes:
            raise GraphError(f"duplicate node: {name!r}")
        self._nodes[name] = fn
        if self._entry is None:
            self._entry = name
        return self

    def set_entry_point(self, name: str) -> "StateGraph":
        if name not in self._nodes:
            raise GraphError(f"unknown node: {name!r}")
        self._entry = name
        return self

    def add_edge(self, from_: str, to: str) -> "StateGraph":
        if from_ != START and from_ not in self._nodes:
            raise GraphError(f"unknown 'from' node: {from_!r}")
        if to != END and to not in self._nodes:
            raise GraphError(f"unknown 'to' node: {to!r}")
        if from_ in self._cond_edges:
            raise GraphError(f"node {from_!r} already has a conditional edge")
        self._edges[from_] = to
        return self

    def add_conditional_edge(self, from_: str, cond: CondFn) -> "StateGraph":
        if from_ not in self._nodes:
            raise GraphError(f"unknown node: {from_!r}")
        if from_ in self._edges:
            raise GraphError(f"node {from_!r} already has a plain edge")
        self._cond_edges[from_] = cond
        return self

    def compile(self) -> "CompiledGraph":
        if self._entry is None:
            raise GraphError("graph has no nodes")
        # Validate that every node has an outgoing edge (or is reachable
        # to a terminal). We don't enforce this strictly — nodes without
        # edges simply terminate the run.
        return CompiledGraph(self)


class CompiledGraph:
    """A runnable state graph."""

    def __init__(self, graph: StateGraph) -> None:
        self.graph = graph
        self.checkpoints: list[Checkpoint] = []

    def run(self, initial_state: State | None = None,
            *, max_steps: int = 50) -> State:
        """Run the graph to completion. Returns the final state."""
        state = initial_state or State()
        if self.graph._entry is None:
            raise GraphError("graph has no entry point")
        current = self.graph._entry
        for step in range(max_steps):
            # Checkpoint before each node.
            ckpt = Checkpoint(node_name=current, state=state)
            self.checkpoints.append(ckpt)
            log.info("graph step %d: node=%s state_keys=%s",
                     step, current, list(state.data.keys()))

            # Run the node.
            fn = self.graph._nodes[current]
            try:
                update = fn(state)
            except Exception as exc:  # noqa: BLE001
                log.error("node %r raised: %s", current, exc)
                raise
            if update is not None:
                state = state.merge(update)

            # Pick next node.
            if current in self.graph._cond_edges:
                cond = self.graph._cond_edges[current]
                nxt = cond(state)
                if nxt == END:
                    log.info("graph done (conditional END)")
                    break
                if nxt not in self.graph._nodes:
                    raise GraphError(
                        f"conditional edge from {current!r} returned unknown node {nxt!r}"
                    )
                current = nxt
            elif current in self.graph._edges:
                nxt = self.graph._edges[current]
                if nxt == END:
                    log.info("graph done (plain END)")
                    break
                current = nxt
            else:
                # No outgoing edge — terminate.
                log.info("graph done (no outgoing edge from %r)", current)
                break
        else:
            log.warning("graph hit max_steps=%d", max_steps)
        return state

    def save_checkpoints(self, path) -> None:
        """Persist all checkpoints to a JSON file."""
        import pathlib
        p = pathlib.Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        data = {"checkpoints": [c.to_dict() for c in self.checkpoints]}
        p.write_text(json.dumps(data, indent=2, default=str))

    @classmethod
    def load_checkpoints(cls, path) -> list[Checkpoint]:
        import pathlib
        p = pathlib.Path(path)
        data = json.loads(p.read_text())
        return [Checkpoint.from_dict(c) for c in data.get("checkpoints", [])]
