#!/usr/bin/env python3
"""Smoke test: persona + learning-graph end-to-end against GLM."""

from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from kairo.agent import Agent, AgentConfig


def main() -> int:
    with open("/etc/.z-ai-config") as f:
        zcfg = json.load(f)
    os.environ["ZAI_API_KEY"] = zcfg["apiKey"]
    if zcfg.get("token"):
        os.environ["ZAI_TOKEN"] = zcfg["token"]
    if zcfg.get("chatId"):
        os.environ["ZAI_CHAT_ID"] = zcfg["chatId"]
    if zcfg.get("userId"):
        os.environ["ZAI_USER_ID"] = zcfg["userId"]

    from kairo.config import DEFAULT_CONFIG
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    for name in list(cfg.providers):
        cfg.providers[name].enabled = (name == "glm")
    cfg.providers["glm"].enabled = True
    cfg.providers["glm"].base_url = zcfg["baseUrl"]
    cfg.providers["glm"].api_key_env = "ZAI_API_KEY"
    cfg.providers["glm"].default_model = "glm-4.6"
    cfg.safety.max_turns = 8
    cfg.orchestrator.enabled = False

    workspace = Path("/tmp/kairo-persona-smoke")
    workspace.mkdir(parents=True, exist_ok=True)
    cfg.workdir = workspace / ".kairo"
    cfg.persist_turns = True

    print("=== Run 1: with persona + learning ===")
    persona_path = Path(__file__).resolve().parent.parent / "examples" / "soul.md"
    agent = Agent(cfg, AgentConfig(
        workspace=workspace,
        persona_path=persona_path,
    ))
    r = agent.run("Use the write_file tool to create a file called 'mark.txt' "
                  "with the content 'kairo was here' and confirm.")
    print(f"  finish={r.finish_reason} turns={len(r.turns)}")
    print(f"  file exists: {(workspace / 'mark.txt').exists()}")
    last = next((m for m in reversed(r.messages) if m.role.value == "assistant" and m.content), None)
    if last:
        print(f"  reply: {last.content[:200]}")

    print("\n=== Learning graph stats after run ===")
    from kairo.agent import LearningGraph
    g = LearningGraph.load(cfg.workdir)
    print(json.dumps(g.stats(), indent=2))

    print("\n=== Run 2: similar task — should get a learning hint ===")
    agent2 = Agent(cfg, AgentConfig(
        workspace=workspace,
        persona_path=persona_path,
    ))
    # Check that the system prompt contains a hint.
    sys_msgs = [m for m in agent2.messages if m.role.value == "system"]
    # The messages list is empty until run() is called, so we test the
    # hint directly.
    hint = agent2.learning.hint_for("Use write_file to create a file")
    print(f"  hint: {hint[:300] if hint else '(none)'}")
    if hint and "write_file" in hint:
        print("  ✓ learning graph injected a hint")
    else:
        print("  ! no learning hint (may be expected if no similar match)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
