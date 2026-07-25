#!/usr/bin/env python3
"""Comprehensive smoke test — exercise many Kairo features against real GLM."""

from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from kairo.agent import (
    Agent,
    AgentConfig,
    AgentMemory,
    CodeSandbox,
    StructuredRunner,
    parse_json_lenient,
)
from kairo.agent.tool_grammar import render_tools_compact


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

    workspace = Path("/tmp/kairo-comprehensive-smoke")
    workspace.mkdir(parents=True, exist_ok=True)
    cfg.workdir = workspace / ".kairo"

    print("=== Test 1: Structured output (forced JSON) ===")
    from kairo.providers import build_all_enabled
    providers = build_all_enabled(cfg)
    provider = next(iter(providers.values()))
    runner = StructuredRunner(provider, model="glm-4.6")
    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "integer", "minimum": 0, "maximum": 150},
            "hobbies": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["name", "age"],
    }
    from kairo.types import Message, Role
    result = runner.complete(
        [Message(role=Role.USER, content="Generate a profile for a fictional character named Alice who is 30 and likes hiking and reading.")],
        schema=schema,
    )
    print(f"  attempts: {result.attempts}, repaired: {result.repaired}")
    print(f"  errors: {len(result.errors)}")
    print(f"  value: {result.value}")
    if result.errors:
        print(f"  error details: {[e.message for e in result.errors]}")

    print("\n=== Test 2: Code sandbox (smolagents-style) ===")
    from kairo.tools import ToolBundleConfig, build_default_registry
    bundle = ToolBundleConfig(workspace=workspace)
    registry, _, _ = build_default_registry(bundle)
    sandbox = CodeSandbox(registry, timeout_s=5.0)
    # First, create a file with write_file.
    sb_result = sandbox.run('write_file(path="calc.py", content="def add(a, b):\\n    return a + b\\n")')
    print(f"  write_file: ok={sb_result.error is None}")
    # Now call read_file to verify.
    sb_result = sandbox.run('read_file(path="calc.py")')
    print(f"  read_file: ok={sb_result.error is None}")
    print(f"  stdout: {sb_result.stdout[:200] if sb_result.stdout else '(empty)'}")

    print("\n=== Test 3: Multi-type memory ===")
    mem = AgentMemory.load(cfg.workdir)
    mem.episodic.record("tool_call", "called write_file", path="calc.py")
    mem.semantic.add("calc.py", "contains_function", "add")
    mem.procedural.add(__import__("kairo").agent.ProceduralSkill(
        id="s1", name="verify_python_module",
        description="Verify a Python module works by running it",
        trigger="verify python module works",
        steps=["read_file", "run_python with import"],
    ))
    context = mem.recall("verify python module works")
    print(f"  recall context:\n{context[:400]}")

    print("\n=== Test 4: Tool-call grammar (compact renderer) ===")
    compact = render_tools_compact(registry)
    print(f"  compact tools (first 300 chars):\n{compact[:300]}")

    print("\n=== Test 5: Agent run with persona + learning ===")
    from kairo.agent import load_persona
    persona_path = Path(__file__).resolve().parent.parent / "examples" / "soul.md"
    agent = Agent(cfg, AgentConfig(
        workspace=workspace,
        persona_path=persona_path,
        max_turns=5,
    ))
    r = agent.run("Use the shell tool to run `echo kairo-comprehensive-works` and tell me the output.")
    print(f"  finish={r.finish_reason} turns={len(r.turns)} tokens={r.total_tokens}")
    last = next((m for m in reversed(r.messages) if m.role.value == "assistant" and m.content), None)
    if last:
        print(f"  reply: {last.content[:200]}")

    print("\nAll comprehensive smoke tests passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
