#!/usr/bin/env python3
"""Smoke test: code_search + SWE tools against real GLM."""

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
    cfg.safety.max_turns = 10
    cfg.orchestrator.enabled = False

    workspace = Path("/tmp/kairo-swe-smoke")
    workspace.mkdir(parents=True, exist_ok=True)
    # Seed the workspace with some Python code.
    (workspace / "auth.py").write_text(
        "def login(user, password):\n"
        "    return authenticate(user, password)\n\n"
        "def authenticate(user, password):\n"
        "    return check_credentials(user, password)\n\n"
        "def check_credentials(user, password):\n"
        "    return user == 'admin' and password == 'secret'\n"
    )
    (workspace / "billing.py").write_text(
        "def charge(customer, amount):\n"
        "    return process_payment(customer, amount)\n\n"
        "def process_payment(customer, amount):\n"
        "    log_transaction(customer, amount)\n"
        "    return True\n"
    )
    cfg.workdir = workspace / ".kairo"

    print("=== Test: code_search + get_signature + find_references ===")
    agent = Agent(cfg, AgentConfig(workspace=workspace))
    r = agent.run(
        "I need to understand how authentication works in this codebase. "
        "Use code_search to find authentication-related code, then use "
        "get_signature on any relevant files, then use find_references "
        "to see who calls the login function. Finally summarize what you found."
    )
    print(f"  finish={r.finish_reason} turns={len(r.turns)} tokens={r.total_tokens}")
    last = next((m for m in reversed(r.messages) if m.role.value == "assistant" and m.content), None)
    if last:
        print(f"\n--- Agent's summary ---\n{last.content[:1500]}")
    return 0 if r.finish_reason == "complete" else 1


if __name__ == "__main__":
    sys.exit(main())
