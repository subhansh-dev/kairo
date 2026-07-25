"""Persistent learning graph — Kairo remembers what worked.

Every time the agent succeeds at a task, it records:
  * The task prompt (hashed for dedup).
  * The system prompt that was in use.
  * The model + provider that succeeded.
  * Which tools were called and how many times.
  * The final assistant text.

When a similar task comes in later, the learning graph is queried for
the closest past successes and a short hint is injected into the
system prompt: "Last time you saw a similar task, you used tools X, Y
and approach Z. That worked."

This is a lightweight form of in-context learning across runs. It is
NOT a fine-tune — Kairo never modifies model weights. It's a structured
memory that the agent can read on the next run.

Storage: a single JSON file under ``workdir/learning_graph.json``. For
production use you'd swap this for SQLite or a vector store, but the
JSON file is good enough for single-user sessions and trivially
inspectable.
"""

from __future__ import annotations

import hashlib
import json
import re
import threading
import time
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any

from kairo.utils import get_logger

log = get_logger("agent.learning")


@dataclass(slots=True)
class LearningEntry:
    """One recorded success."""

    prompt_hash: str
    prompt_preview: str
    system_prompt_hash: str
    model: str
    provider: str
    tools_used: list[str]
    tool_call_count: int
    final_text_preview: str
    duration_s: float
    tokens: int
    recorded_at: float


@dataclass(slots=True)
class LearningGraph:
    """Persistent memory of past agent successes.

    Thread-safe. Auto-saves to ``workdir/learning_graph.json`` on every
    mutation when ``autosave=True`` (the default).
    """

    workdir: Path
    entries: list[LearningEntry] = field(default_factory=list)
    autosave: bool = True
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)
    _dirty: bool = field(default=False, repr=False)

    # -- lifecycle -----------------------------------------------------

    @classmethod
    def load(cls, workdir: Path, *, autosave: bool = True) -> "LearningGraph":
        workdir = Path(workdir)
        workdir.mkdir(parents=True, exist_ok=True)
        path = workdir / "learning_graph.json"
        g = cls(workdir=workdir, autosave=autosave)
        if path.is_file():
            try:
                data = json.loads(path.read_text())
                for raw in data.get("entries", []):
                    g.entries.append(LearningEntry(**raw))
                log.info("loaded %d learning entries from %s", len(g.entries), path)
            except Exception as exc:  # noqa: BLE001
                log.warning("could not load learning graph: %s", exc)
        return g

    def save(self) -> None:
        with self._lock:
            path = self.workdir / "learning_graph.json"
            data = {"entries": [asdict(e) for e in self.entries]}
            path.write_text(json.dumps(data, indent=2, default=str))
            self._dirty = False

    def _maybe_save(self) -> None:
        if self.autosave and self._dirty:
            self.save()

    # -- mutation ------------------------------------------------------

    def record_success(
        self,
        *,
        prompt: str,
        system_prompt: str,
        model: str,
        provider: str,
        tools_used: list[str],
        tool_call_count: int,
        final_text: str,
        duration_s: float,
        tokens: int,
    ) -> LearningEntry:
        """Record a successful run. Dedupes by prompt+system hash."""
        prompt_hash = _hash(prompt)
        system_hash = _hash(system_prompt)
        entry = LearningEntry(
            prompt_hash=prompt_hash,
            prompt_preview=prompt[:200],
            system_prompt_hash=system_hash,
            model=model,
            provider=provider,
            tools_used=tools_used,
            tool_call_count=tool_call_count,
            final_text_preview=final_text[:500],
            duration_s=duration_s,
            tokens=tokens,
            recorded_at=time.time(),
        )
        with self._lock:
            # Remove any prior entry with the same prompt+system hash.
            self.entries = [
                e for e in self.entries
                if not (e.prompt_hash == prompt_hash and e.system_prompt_hash == system_hash)
            ]
            self.entries.append(entry)
            self._dirty = True
            self._maybe_save()
        return entry

    # -- query ---------------------------------------------------------

    def find_similar(self, prompt: str, *, limit: int = 3) -> list[LearningEntry]:
        """Find past successes with prompts similar to ``prompt``.

        Similarity is currently computed as token-overlap on word sets
        (Jaccard). For better matches, swap in an embedding model.
        """
        prompt_words = _word_set(prompt)
        if not prompt_words:
            return []
        scored: list[tuple[float, LearningEntry]] = []
        with self._lock:
            for entry in self.entries:
                entry_words = _word_set(entry.prompt_preview)
                if not entry_words:
                    continue
                score = len(prompt_words & entry_words) / len(prompt_words | entry_words)
                if score > 0.1:
                    scored.append((score, entry))
        scored.sort(key=lambda x: -x[0])
        return [e for _, e in scored[:limit]]

    def hint_for(self, prompt: str, *, limit: int = 2) -> str | None:
        """Build a short hint string for the next agent run.

        Returns None if no similar past successes exist.
        """
        matches = self.find_similar(prompt, limit=limit)
        if not matches:
            return None
        lines = [
            "Hint from past successful runs on similar tasks:",
        ]
        for m in matches:
            tool_str = ", ".join(m.tools_used[:5]) or "(none)"
            lines.append(
                f"- Used {tool_str} on {m.provider}:{m.model}, "
                f"completed in {m.duration_s:.0f}s. "
                f"Final output: {m.final_text_preview[:100]}..."
            )
        return "\n".join(lines)

    # -- stats ---------------------------------------------------------

    def stats(self) -> dict[str, Any]:
        with self._lock:
            return {
                "entry_count": len(self.entries),
                "unique_prompts": len({e.prompt_hash for e in self.entries}),
                "models_used": list({f"{e.provider}:{e.model}" for e in self.entries}),
                "most_used_tools": _top_tools(self.entries),
            }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:16]


def _word_set(s: str) -> set[str]:
    # Lowercase, strip punctuation, split on whitespace, drop stopwords.
    stop = {"the", "a", "an", "to", "and", "or", "for", "of", "in", "on",
            "with", "is", "are", "be", "this", "that", "it", "as", "by",
            "at", "from", "i", "you", "we", "they", "he", "she"}
    words = re.findall(r"[a-zA-Z_][a-zA-Z0-9_]*", s.lower())
    return {w for w in words if len(w) > 2 and w not in stop}


def _top_tools(entries: list[LearningEntry]) -> list[tuple[str, int]]:
    counts: dict[str, int] = {}
    for e in entries:
        for t in e.tools_used:
            counts[t] = counts.get(t, 0) + 1
    return sorted(counts.items(), key=lambda x: -x[1])[:10]
