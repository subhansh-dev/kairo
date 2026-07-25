"""Multi-type agent memory — episodic + semantic + procedural.

Three memory stores, inspired by the cognitive-science classification:

  * **Episodic**: timestamped events ("agent ran X tool at T, got Y result").
    Surface recent events to the agent so it has continuity.
  * **Semantic**: facts ("file foo.py contains function bar()"). Add
    new facts, query by topic, retract stale facts.
  * **Procedural**: learned skills ("to fix a SyntaxError in foo.py,
  read the file, locate the line, edit_file with corrected syntax").
    Skill-acquisition is the same idea as our LearningGraph but more
    structured — each skill is a reusable plan, not just a hint.

All three are persisted to a single JSON file per type under
``workdir/memory/``. The combined :class:`AgentMemory` wraps all three
and provides a unified ``recall`` method that returns relevant context
for a new query.
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

log = get_logger("agent.memory_types")


# ---------------------------------------------------------------------------
# Episodic memory — timestamped events
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class EpisodicEvent:
    """A single timestamped event in the agent's history."""

    ts: float
    kind: str  # "tool_call", "tool_result", "agent_run", "error", etc.
    summary: str
    payload: dict[str, Any] = field(default_factory=dict)


class EpisodicMemory:
    """Append-only log of events. Query by recency or kind."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path
        self.events: list[EpisodicEvent] = []
        self._lock = threading.RLock()
        if path and path.is_file():
            self._load()

    def record(self, kind: str, summary: str, **payload: Any) -> EpisodicEvent:
        ev = EpisodicEvent(ts=time.time(), kind=kind, summary=summary, payload=payload)
        with self._lock:
            self.events.append(ev)
            # Cap to last 1000 events to avoid unbounded growth.
            if len(self.events) > 1000:
                self.events = self.events[-1000:]
            self._maybe_save()
        return ev

    def recent(self, n: int = 10, kind: str | None = None) -> list[EpisodicEvent]:
        with self._lock:
            evs = list(self.events)
        if kind:
            evs = [e for e in evs if e.kind == kind]
        return evs[-n:]

    def since(self, ts: float) -> list[EpisodicEvent]:
        with self._lock:
            return [e for e in self.events if e.ts >= ts]

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text())
            for raw in data.get("events", []):
                self.events.append(EpisodicEvent(**raw))
        except Exception as exc:  # noqa: BLE001
            log.warning("episodic memory load failed: %s", exc)

    def _maybe_save(self) -> None:
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            data = {"events": [asdict(e) for e in self.events]}
            self.path.write_text(json.dumps(data, default=str, indent=2))
        except Exception as exc:  # noqa: BLE001
            log.warning("episodic memory save failed: %s", exc)


# ---------------------------------------------------------------------------
# Semantic memory — facts
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class SemanticFact:
    """A stored fact."""

    id: str
    subject: str  # e.g. "src/foo.py"
    predicate: str  # e.g. "contains_function"
    object: str  # e.g. "bar"
    confidence: float = 1.0
    ts: float = field(default_factory=time.time)
    source: str = "agent"  # who added this fact


class SemanticMemory:
    """Triple store (subject, predicate, object) with confidence + timestamps."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path
        self.facts: dict[str, SemanticFact] = {}
        self._lock = threading.RLock()
        if path and path.is_file():
            self._load()

    def add(self, subject: str, predicate: str, object: str,
            *, confidence: float = 1.0, source: str = "agent") -> SemanticFact:
        # Dedupe: same (s, p, o) overwrites.
        fact_id = self._fact_id(subject, predicate, object)
        fact = SemanticFact(
            id=fact_id, subject=subject, predicate=predicate, object=object,
            confidence=confidence, source=source,
        )
        with self._lock:
            self.facts[fact_id] = fact
            self._maybe_save()
        return fact

    def remove(self, subject: str, predicate: str, object: str) -> bool:
        fact_id = self._fact_id(subject, predicate, object)
        with self._lock:
            existed = fact_id in self.facts
            self.facts.pop(fact_id, None)
            if existed:
                self._maybe_save()
            return existed

    def query(self, *, subject: str | None = None,
              predicate: str | None = None,
              object: str | None = None) -> list[SemanticFact]:
        with self._lock:
            results = []
            for f in self.facts.values():
                if subject is not None and f.subject != subject:
                    continue
                if predicate is not None and f.predicate != predicate:
                    continue
                if object is not None and f.object != object:
                    continue
                results.append(f)
        return results

    def search_text(self, query: str) -> list[SemanticFact]:
        """Free-text search across subject/predicate/object.

        Matches if any query word appears in subject, predicate, or object.
        """
        q_words = [w.lower() for w in query.split() if len(w) > 1]
        if not q_words:
            return []
        with self._lock:
            results = []
            for f in self.facts.values():
                blob = (f.subject + " " + f.predicate + " " + f.object).lower()
                if any(q in blob for q in q_words):
                    results.append(f)
        return results

    def _fact_id(self, s: str, p: str, o: str) -> str:
        return hashlib.sha256(f"{s}|{p}|{o}".encode()).hexdigest()[:16]

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text())
            for raw in data.get("facts", []):
                f = SemanticFact(**raw)
                self.facts[f.id] = f
        except Exception as exc:  # noqa: BLE001
            log.warning("semantic memory load failed: %s", exc)

    def _maybe_save(self) -> None:
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            data = {"facts": [asdict(f) for f in self.facts.values()]}
            self.path.write_text(json.dumps(data, default=str, indent=2))
        except Exception as exc:  # noqa: BLE001
            log.warning("semantic memory save failed: %s", exc)


# ---------------------------------------------------------------------------
# Procedural memory — learned skills (reusable plans)
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class ProceduralSkill:
    """A reusable plan / skill learned from past runs."""

    id: str
    name: str
    description: str
    # When this skill applies (natural language description of trigger).
    trigger: str
    # The plan: ordered list of step descriptions.
    steps: list[str]
    # Tags for filtering.
    tags: list[str] = field(default_factory=list)
    # How many times this skill has been used.
    use_count: int = 0
    # Last used timestamp.
    last_used_ts: float = 0.0
    # When the skill was created.
    created_ts: float = field(default_factory=time.time)


class ProceduralMemory:
    """Reusable skill library."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path
        self.skills: dict[str, ProceduralSkill] = {}
        self._lock = threading.RLock()
        if path and path.is_file():
            self._load()

    def add(self, skill: ProceduralSkill) -> None:
        with self._lock:
            self.skills[skill.id] = skill
            self._maybe_save()

    def get(self, skill_id: str) -> ProceduralSkill | None:
        with self._lock:
            return self.skills.get(skill_id)

    def find_by_trigger(self, query: str, limit: int = 3) -> list[ProceduralSkill]:
        """Find skills whose trigger matches the query (word overlap)."""
        q_words = _word_set(query)
        if not q_words:
            return []
        scored: list[tuple[float, ProceduralSkill]] = []
        with self._lock:
            for s in self.skills.values():
                t_words = _word_set(s.trigger + " " + s.description)
                if not t_words:
                    continue
                score = len(q_words & t_words) / len(q_words | t_words)
                if score > 0.15:
                    scored.append((score, s))
        scored.sort(key=lambda x: -x[0])
        return [s for _, s in scored[:limit]]

    def record_use(self, skill_id: str) -> None:
        with self._lock:
            s = self.skills.get(skill_id)
            if s is None:
                return
            s.use_count += 1
            s.last_used_ts = time.time()
            self._maybe_save()

    def all_skills(self) -> list[ProceduralSkill]:
        with self._lock:
            return list(self.skills.values())

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text())
            for raw in data.get("skills", []):
                s = ProceduralSkill(**raw)
                self.skills[s.id] = s
        except Exception as exc:  # noqa: BLE001
            log.warning("procedural memory load failed: %s", exc)

    def _maybe_save(self) -> None:
        if self.path is None:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            data = {"skills": [asdict(s) for s in self.skills.values()]}
            self.path.write_text(json.dumps(data, default=str, indent=2))
        except Exception as exc:  # noqa: BLE001
            log.warning("procedural memory save failed: %s", exc)


# ---------------------------------------------------------------------------
# Combined AgentMemory
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class AgentMemory:
    """All three memory types + a unified recall method."""

    episodic: EpisodicMemory
    semantic: SemanticMemory
    procedural: ProceduralMemory

    @classmethod
    def load(cls, workdir: Path) -> "AgentMemory":
        mem_dir = workdir / "memory"
        mem_dir.mkdir(parents=True, exist_ok=True)
        return cls(
            episodic=EpisodicMemory(mem_dir / "episodic.json"),
            semantic=SemanticMemory(mem_dir / "semantic.json"),
            procedural=ProceduralMemory(mem_dir / "procedural.json"),
        )

    def recall(self, query: str, *, n_events: int = 5, n_facts: int = 5,
               n_skills: int = 2) -> str:
        """Build a context string with relevant memories for ``query``."""
        lines: list[str] = []
        events = self.episodic.recent(n=n_events)
        if events:
            lines.append("Recent events:")
            for e in events:
                lines.append(f"  - [{e.kind}] {e.summary}")
        facts = self.semantic.search_text(query)[:n_facts]
        if facts:
            lines.append("\nRelevant facts:")
            for f in facts:
                lines.append(f"  - {f.subject} {f.predicate} {f.object}")
        skills = self.procedural.find_by_trigger(query, limit=n_skills)
        if skills:
            lines.append("\nApplicable skills:")
            for s in skills:
                lines.append(f"  - {s.name}: {s.description}")
                for step in s.steps:
                    lines.append(f"      {step}")
        return "\n".join(lines) if lines else "(no relevant memories)"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _word_set(s: str) -> set[str]:
    stop = {"the", "a", "an", "to", "and", "or", "for", "of", "in", "on",
            "with", "is", "are", "be", "this", "that", "it", "as", "by",
            "at", "from", "i", "you", "we", "they", "he", "she"}
    words = re.findall(r"[a-zA-Z_][a-zA-Z0-9_]*", s.lower())
    return {w for w in words if len(w) > 2 and w not in stop}
