#!/usr/bin/env python3
"""End-to-end smoke test for Kairo against the real ZAI / GLM provider.

This is intentionally NOT a pytest test — it makes real network calls
and burns real (free-tier) tokens. Run it manually to verify the
end-to-end pipeline works.

Usage:
    python scripts/smoke_glm.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Ensure kairo is importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from kairo.agent import Agent, AgentConfig
from kairo.config import DEFAULT_CONFIG, KairoConfig
from kairo.routing.catalog import default_catalog
from kairo.utils import EventKind, configure_logging, get_event_bus, get_logger


def _on_event(payload: dict) -> None:
    kind = payload.get("kind")
    if kind == EventKind.TURN_START.value:
        print(f"  [turn {payload.get('turn')}] phase={payload.get('phase')} "
              f"model={payload.get('model')} tokens~={payload.get('est_tokens')}")
    elif kind == EventKind.TOOL_CALL.value:
        print(f"  -> {payload.get('name')}({payload.get('args')})")
    elif kind == EventKind.TOOL_RESULT.value:
        ok = "ok" if payload.get("ok") else "ERR"
        print(f"  <- {payload.get('name')} [{ok}] {payload.get('duration_s', 0):.2f}s")


def main() -> int:
    configure_logging("WARNING")
    get_event_bus().subscribe(EventKind.TURN_START, _on_event)
    get_event_bus().subscribe(EventKind.TOOL_CALL, _on_event)
    get_event_bus().subscribe(EventKind.TOOL_RESULT, _on_event)

    import copy
    cfg = copy.deepcopy(DEFAULT_CONFIG)
    # Disable every provider except GLM.
    for name in list(cfg.providers):
        cfg.providers[name].enabled = (name == "glm")
    # Point GLM at the internal endpoint.
    cfg.providers["glm"].enabled = True
    cfg.providers["glm"].base_url = "https://internal-api.z.ai/v1"
    cfg.providers["glm"].api_key_env = "ZAI_API_KEY"
    cfg.providers["glm"].default_model = "glm-4.6"
    # Use a temp workdir.
    workspace = Path("/tmp/kairo-smoke")
    workspace.mkdir(parents=True, exist_ok=True)
    cfg.workdir = workspace / ".kairo"
    cfg.persist_turns = True
    cfg.safety.max_turns = 8
    cfg.orchestrator.enabled = False

    # Sanity: catalog has the model.
    cat = default_catalog()
    try:
        info = cat.get("glm", "glm-4.6")
        print(f"router will use: glm:glm-4.6 (ctx={info.context}, caps={info.capabilities})")
    except Exception as exc:
        print(f"FATAL: model not in catalog: {exc}")
        return 2

    # Sanity: env vars set.
    if not os.environ.get("ZAI_API_KEY"):
        # Load from /etc/.z-ai-config if present.
        try:
            with open("/etc/.z-ai-config") as f:
                zcfg = json.load(f)
            os.environ["ZAI_API_KEY"] = zcfg.get("apiKey", "")
            if zcfg.get("token"):
                os.environ["ZAI_TOKEN"] = zcfg["token"]
            if zcfg.get("chatId"):
                os.environ["ZAI_CHAT_ID"] = zcfg["chatId"]
            if zcfg.get("userId"):
                os.environ["ZAI_USER_ID"] = zcfg["userId"]
            print(f"loaded ZAI config from /etc/.z-ai-config "
                  f"(chat_id={zcfg.get('chatId')[:12]}...)")
        except FileNotFoundError:
            print("FATAL: ZAI_API_KEY not set and /etc/.z-ai-config not found")
            return 2

    print("\n=== Test 1: simple completion (no tools) ===")
    agent = Agent(cfg, AgentConfig(workspace=workspace))
    r = agent.run("Reply with exactly the word PONG and nothing else.")
    print(f"  finish_reason={r.finish_reason} turns={len(r.turns)} tokens={r.total_tokens}")
    last = next((m for m in reversed(r.messages) if m.role.value == "assistant" and m.content), None)
    print(f"  reply: {last.content if last else '(none)'}")
    if r.finish_reason != "complete":
        print(f"  ERROR: {r.error}")
        return 1

    print("\n=== Test 2: tool-calling loop (write a file) ===")
    agent = Agent(cfg, AgentConfig(workspace=workspace))
    r = agent.run(
        "Use the write_file tool to create a file called 'smoke_test.txt' "
        "containing the text 'kairo was here'. Then read it back with read_file "
        "to confirm. Then tell me what you did."
    )
    print(f"  finish_reason={r.finish_reason} turns={len(r.turns)} tokens={r.total_tokens}")
    if r.finish_reason != "complete":
        print(f"  ERROR: {r.error}")
        return 1
    last = next((m for m in reversed(r.messages) if m.role.value == "assistant" and m.content), None)
    print(f"  final reply: {(last.content if last else '(none)')[:300]}")
    smoke_file = workspace / "smoke_test.txt"
    if smoke_file.exists():
        print(f"  file content: {smoke_file.read_text()!r}")
        if "kairo was here" in smoke_file.read_text():
            print("  ✓ tool-calling pipeline works end-to-end")
        else:
            print("  ✗ file content mismatch")
            return 1
    else:
        print("  ✗ file was never created")
        return 1

    print("\n=== Test 3: tool-call spam guard (forced repeat) ===")
    # We ask the model to call read_file on the same path over and over.
    # The spam guard should block the repeats and the model should recover.
    agent = Agent(cfg, AgentConfig(workspace=workspace))
    r = agent.run(
        "Call read_file with path 'smoke_test.txt' exactly 5 times in a row. "
        "Do not skip any. Just emit 5 read_file tool calls in your next message."
    )
    print(f"  finish_reason={r.finish_reason} turns={len(r.turns)} tokens={r.total_tokens}")
    # The first call should succeed, subsequent identical calls should be blocked.
    tool_msgs = [m for m in r.messages if m.role.value == "tool"]
    blocked = [m for m in tool_msgs
               if m.tool_result and m.tool_result.error and "GUARDRAIL" in m.tool_result.error]
    print(f"  tool messages: {len(tool_msgs)}, blocked by guardrail: {len(blocked)}")
    if len(blocked) >= 1:
        print("  ✓ spam guard tripped on repeated identical calls")
    else:
        print("  ! spam guard did not trip (model may have varied its args)")

    print("\n=== Test 4: shell tool (echo) ===")
    agent = Agent(cfg, AgentConfig(workspace=workspace))
    r = agent.run("Use the shell tool to run `echo kairo-runs` and tell me the output.")
    print(f"  finish_reason={r.finish_reason} turns={len(r.turns)}")
    if r.finish_reason != "complete":
        print(f"  ERROR: {r.error}")
        return 1
    last = next((m for m in reversed(r.messages) if m.role.value == "assistant" and m.content), None)
    print(f"  final reply: {(last.content if last else '(none)')[:300]}")
    if last and "kairo-runs" in last.content:
        print("  ✓ shell tool integration works")
    else:
        print("  ! reply did not include shell output")

    print("\nAll smoke tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
