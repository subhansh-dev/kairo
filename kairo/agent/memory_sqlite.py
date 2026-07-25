"""SQLite-backed memory stores — production-scale alternative to JSON.

The default :class:`EpisodicMemory` / :class:`SemanticMemory` /
:class:`ProceduralMemory` persist to JSON files. That's fine for
single-user sessions, but it doesn't scale past ~10K events because
every mutation rewrites the whole file.

This module provides SQLite-backed versions of all three memory types.
They have the same public API as the JSON versions, so you can swap
them in by changing one import:

    from kairo.agent.memory_sqlite import (
        EpisodicMemorySQLite as EpisodicMemory,
        SemanticMemorySQLite as SemanticMemory,
        ProceduralMemorySQLite as ProceduralMemory,
        AgentMemorySQLite as AgentMemory,
    )

SQLite is in the Python stdlib, so there are no extra dependencies.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from kairo.agent.memory_types import (
    EpisodicEvent,
    ProceduralSkill,
    SemanticFact,
    _word_set,
)
from kairo.utils import get_logger

log = get_logger("agent.memory_sqlite")


# ---------------------------------------------------------------------------
# Episodic
# ---------------------------------------------------------------------------

class EpisodicMemorySQLite:
    """SQLite-backed episodic memory. Same API as :class:`EpisodicMemory`."""

    def __init__(self, db_path: Path | str) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.execute("""
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ts REAL NOT NULL,
                    kind TEXT NOT NULL,
                    summary TEXT NOT NULL,
                    payload TEXT
                )
            """)
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts)")
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind)")
            self._conn.commit()

    def record(self, kind: str, summary: str, **payload: Any) -> EpisodicEvent:
        ts = time.time()
        payload_str = json.dumps(payload, default=str) if payload else "{}"
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO events (ts, kind, summary, payload) VALUES (?, ?, ?, ?)",
                (ts, kind, summary, payload_str),
            )
            self._conn.commit()
            event_id = cur.lastrowid
        return EpisodicEvent(ts=ts, kind=kind, summary=summary, payload=payload)

    def recent(self, n: int = 10, kind: str | None = None) -> list[EpisodicEvent]:
        with self._lock:
            if kind:
                cur = self._conn.execute(
                    "SELECT ts, kind, summary, payload FROM events WHERE kind = ? "
                    "ORDER BY id DESC LIMIT ?",
                    (kind, n),
                )
            else:
                cur = self._conn.execute(
                    "SELECT ts, kind, summary, payload FROM events "
                    "ORDER BY id DESC LIMIT ?",
                    (n,),
                )
            rows = cur.fetchall()
        out: list[EpisodicEvent] = []
        for row in reversed(rows):  # chronological order
            payload = json.loads(row["payload"]) if row["payload"] else {}
            out.append(EpisodicEvent(
                ts=row["ts"], kind=row["kind"], summary=row["summary"], payload=payload,
            ))
        return out

    def since(self, ts: float) -> list[EpisodicEvent]:
        with self._lock:
            cur = self._conn.execute(
                "SELECT ts, kind, summary, payload FROM events WHERE ts >= ? "
                "ORDER BY id ASC",
                (ts,),
            )
            rows = cur.fetchall()
        return [
            EpisodicEvent(
                ts=r["ts"], kind=r["kind"], summary=r["summary"],
                payload=json.loads(r["payload"]) if r["payload"] else {},
            )
            for r in rows
        ]

    def count(self) -> int:
        with self._lock:
            cur = self._conn.execute("SELECT COUNT(*) FROM events")
            return cur.fetchone()[0]

    def close(self) -> None:
        with self._lock:
            self._conn.close()


# ---------------------------------------------------------------------------
# Semantic
# ---------------------------------------------------------------------------

class SemanticMemorySQLite:
    """SQLite-backed semantic memory (triple store)."""

    def __init__(self, db_path: Path | str) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.execute("""
                CREATE TABLE IF NOT EXISTS facts (
                    id TEXT PRIMARY KEY,
                    subject TEXT NOT NULL,
                    predicate TEXT NOT NULL,
                    object TEXT NOT NULL,
                    confidence REAL NOT NULL DEFAULT 1.0,
                    ts REAL NOT NULL,
                    source TEXT NOT NULL DEFAULT 'agent'
                )
            """)
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject)")
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_facts_predicate ON facts(predicate)")
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_facts_object ON facts(object)")
            self._conn.commit()

    def _fact_id(self, s: str, p: str, o: str) -> str:
        import hashlib
        return hashlib.sha256(f"{s}|{p}|{o}".encode()).hexdigest()[:16]

    def add(self, subject: str, predicate: str, object: str,
            *, confidence: float = 1.0, source: str = "agent") -> SemanticFact:
        fact_id = self._fact_id(subject, predicate, object)
        ts = time.time()
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO facts (id, subject, predicate, object, confidence, ts, source) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (fact_id, subject, predicate, object, confidence, ts, source),
            )
            self._conn.commit()
        return SemanticFact(
            id=fact_id, subject=subject, predicate=predicate, object=object,
            confidence=confidence, ts=ts, source=source,
        )

    def remove(self, subject: str, predicate: str, object: str) -> bool:
        fact_id = self._fact_id(subject, predicate, object)
        with self._lock:
            cur = self._conn.execute("DELETE FROM facts WHERE id = ?", (fact_id,))
            self._conn.commit()
            return cur.rowcount > 0

    def query(self, *, subject: str | None = None,
              predicate: str | None = None,
              object: str | None = None) -> list[SemanticFact]:
        sql = "SELECT id, subject, predicate, object, confidence, ts, source FROM facts WHERE 1=1"
        params: list[Any] = []
        if subject is not None:
            sql += " AND subject = ?"
            params.append(subject)
        if predicate is not None:
            sql += " AND predicate = ?"
            params.append(predicate)
        if object is not None:
            sql += " AND object = ?"
            params.append(object)
        with self._lock:
            cur = self._conn.execute(sql, params)
            rows = cur.fetchall()
        return [
            SemanticFact(
                id=r["id"], subject=r["subject"], predicate=r["predicate"],
                object=r["object"], confidence=r["confidence"], ts=r["ts"],
                source=r["source"],
            )
            for r in rows
        ]

    def search_text(self, query: str) -> list[SemanticFact]:
        q_words = [w.lower() for w in query.split() if len(w) > 1]
        if not q_words:
            return []
        # SQLite FTS would be nicer; for now use LIKE on concatenation.
        sql = "SELECT id, subject, predicate, object, confidence, ts, source FROM facts WHERE "
        clauses = []
        params: list[Any] = []
        for w in q_words:
            clauses.append("(LOWER(subject) LIKE ? OR LOWER(predicate) LIKE ? OR LOWER(object) LIKE ?)")
            params.extend([f"%{w}%", f"%{w}%", f"%{w}%"])
        sql += " OR ".join(clauses)
        with self._lock:
            cur = self._conn.execute(sql, params)
            rows = cur.fetchall()
        return [
            SemanticFact(
                id=r["id"], subject=r["subject"], predicate=r["predicate"],
                object=r["object"], confidence=r["confidence"], ts=r["ts"],
                source=r["source"],
            )
            for r in rows
        ]

    def count(self) -> int:
        with self._lock:
            cur = self._conn.execute("SELECT COUNT(*) FROM facts")
            return cur.fetchone()[0]

    def close(self) -> None:
        with self._lock:
            self._conn.close()


# ---------------------------------------------------------------------------
# Procedural
# ---------------------------------------------------------------------------

class ProceduralMemorySQLite:
    """SQLite-backed procedural memory (skill library)."""

    def __init__(self, db_path: Path | str) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.execute("""
                CREATE TABLE IF NOT EXISTS skills (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL,
                    trigger TEXT NOT NULL,
                    steps TEXT NOT NULL,
                    tags TEXT NOT NULL DEFAULT '[]',
                    use_count INTEGER NOT NULL DEFAULT 0,
                    last_used_ts REAL NOT NULL DEFAULT 0,
                    created_ts REAL NOT NULL
                )
            """)
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name)")
            self._conn.commit()

    def add(self, skill: ProceduralSkill) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO skills (id, name, description, trigger, steps, tags, "
                "use_count, last_used_ts, created_ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    skill.id, skill.name, skill.description, skill.trigger,
                    json.dumps(skill.steps), json.dumps(skill.tags),
                    skill.use_count, skill.last_used_ts, skill.created_ts,
                ),
            )
            self._conn.commit()

    def get(self, skill_id: str) -> ProceduralSkill | None:
        with self._lock:
            cur = self._conn.execute("SELECT * FROM skills WHERE id = ?", (skill_id,))
            row = cur.fetchone()
        if row is None:
            return None
        return self._row_to_skill(row)

    def find_by_trigger(self, query: str, limit: int = 3) -> list[ProceduralSkill]:
        q_words = _word_set(query)
        if not q_words:
            return []
        with self._lock:
            cur = self._conn.execute("SELECT * FROM skills")
            rows = cur.fetchall()
        scored: list[tuple[float, ProceduralSkill]] = []
        for row in rows:
            skill = self._row_to_skill(row)
            t_words = _word_set(skill.trigger + " " + skill.description)
            if not t_words:
                continue
            score = len(q_words & t_words) / len(q_words | t_words)
            if score > 0.15:
                scored.append((score, skill))
        scored.sort(key=lambda x: -x[0])
        return [s for _, s in scored[:limit]]

    def record_use(self, skill_id: str) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE skills SET use_count = use_count + 1, last_used_ts = ? WHERE id = ?",
                (time.time(), skill_id),
            )
            self._conn.commit()

    def all_skills(self) -> list[ProceduralSkill]:
        with self._lock:
            cur = self._conn.execute("SELECT * FROM skills")
            rows = cur.fetchall()
        return [self._row_to_skill(r) for r in rows]

    def count(self) -> int:
        with self._lock:
            cur = self._conn.execute("SELECT COUNT(*) FROM skills")
            return cur.fetchone()[0]

    def _row_to_skill(self, row: sqlite3.Row) -> ProceduralSkill:
        return ProceduralSkill(
            id=row["id"], name=row["name"], description=row["description"],
            trigger=row["trigger"], steps=json.loads(row["steps"]),
            tags=json.loads(row["tags"]), use_count=row["use_count"],
            last_used_ts=row["last_used_ts"], created_ts=row["created_ts"],
        )

    def close(self) -> None:
        with self._lock:
            self._conn.close()


# ---------------------------------------------------------------------------
# Combined AgentMemorySQLite
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class AgentMemorySQLite:
    """SQLite-backed version of :class:`AgentMemory`."""

    episodic: EpisodicMemorySQLite
    semantic: SemanticMemorySQLite
    procedural: ProceduralMemorySQLite

    @classmethod
    def load(cls, workdir: Path) -> "AgentMemorySQLite":
        mem_dir = workdir / "memory"
        mem_dir.mkdir(parents=True, exist_ok=True)
        return cls(
            episodic=EpisodicMemorySQLite(mem_dir / "episodic.db"),
            semantic=SemanticMemorySQLite(mem_dir / "semantic.db"),
            procedural=ProceduralMemorySQLite(mem_dir / "procedural.db"),
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

    def close(self) -> None:
        self.episodic.close()
        self.semantic.close()
        self.procedural.close()
