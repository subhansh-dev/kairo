"""Todo / planning tool — a shared TODO list the agent can manipulate.

The TODO state lives in the agent runtime (not the model's context), so
the model can write structured plans and check them off without burning
context on a parallel free-text representation.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from enum import Enum

from kairo.tools.base import tool
from kairo.utils import get_logger

log = get_logger("tools.todo")


class TodoState(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


@dataclass(slots=True)
class TodoItem:
    id: str
    content: str
    state: TodoState = TodoState.PENDING
    priority: str = "medium"  # low|medium|high


@dataclass(slots=True)
class TodoStore:
    items: list[TodoItem] = field(default_factory=list)
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)

    def set(self, items: list[dict]) -> list[TodoItem]:
        with self._lock:
            self.items.clear()
            for raw in items:
                self.items.append(
                    TodoItem(
                        id=str(raw.get("id") or f"todo_{len(self.items) + 1}"),
                        content=str(raw.get("content", "")),
                        state=TodoState(raw.get("state", "pending")),
                        priority=str(raw.get("priority", "medium")),
                    )
                )
            return list(self.items)

    def update(self, item_id: str, state: str | None = None) -> TodoItem | None:
        with self._lock:
            for it in self.items:
                if it.id == item_id:
                    if state is not None:
                        it.state = TodoState(state)
                    return it
            return None

    def list_str(self) -> str:
        with self._lock:
            if not self.items:
                return "(no todos)"
            lines = []
            for it in self.items:
                mark = {"pending": "[ ]", "in_progress": "[~]", "completed": "[x]"}[it.state.value]
                lines.append(f"{mark} {it.id} ({it.priority}) {it.content}")
            return "\n".join(lines)


def make_todo_tools(store: TodoStore):
    @tool(name="todo_set")
    def todo_set(items: list) -> str:
        """Replace the entire TODO list.

        Args:
            items: List of ``{"id","content","state","priority"}`` dicts.

        Returns:
            The new list, formatted.
        """
        if not isinstance(items, list):
            from kairo.errors import ToolError
            raise ToolError("todo_set", "items must be a list")
        clean = []
        for i, raw in enumerate(items):
            if not isinstance(raw, dict):
                raise ToolError("todo_set", f"item #{i} is not an object")
            clean.append(raw)
        store.set(clean)
        return store.list_str()

    @tool(name="todo_update")
    def todo_update(item_id: str, state: str) -> str:
        """Update a single TODO's state.

        Args:
            item_id: The TODO id (e.g. ``todo_3``).
            state: ``pending`` | ``in_progress`` | ``completed``.
        """
        from kairo.errors import ToolError
        if state not in ("pending", "in_progress", "completed"):
            raise ToolError("todo_update", f"invalid state {state!r}")
        updated = store.update(item_id, state)
        if updated is None:
            raise ToolError("todo_update", f"no TODO with id {item_id!r}")
        return store.list_str()

    @tool(name="todo_list")
    def todo_list() -> str:
        """Return the current TODO list."""
        return store.list_str()

    return [todo_set, todo_update, todo_list]
