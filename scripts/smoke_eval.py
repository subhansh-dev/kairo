#!/usr/bin/env python3
"""Run the coding-basics eval suite against the real GLM provider."""

from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from kairo.config import DEFAULT_CONFIG
from kairo.eval import format_report, run_suite


def main() -> int:
    # Load ZAI config.
    with open("/etc/.z-ai-config") as f:
        zcfg = json.load(f)
    os.environ["ZAI_API_KEY"] = zcfg["apiKey"]
    if zcfg.get("token"):
        os.environ["ZAI_TOKEN"] = zcfg["token"]
    if zcfg.get("chatId"):
        os.environ["ZAI_CHAT_ID"] = zcfg["chatId"]
    if zcfg.get("userId"):
        os.environ["ZAI_USER_ID"] = zcfg["userId"]

    cfg = copy.deepcopy(DEFAULT_CONFIG)
    for name in list(cfg.providers):
        cfg.providers[name].enabled = (name == "glm")
    cfg.providers["glm"].enabled = True
    cfg.providers["glm"].base_url = zcfg["baseUrl"]
    cfg.providers["glm"].api_key_env = "ZAI_API_KEY"
    cfg.providers["glm"].default_model = "glm-4.6"
    cfg.safety.max_turns = 8
    cfg.orchestrator.enabled = False

    suite_dir = Path(__file__).resolve().parent.parent / "examples" / "eval-suites" / "coding-basics"
    print(f"Running suite: {suite_dir}")
    report = run_suite(
        str(suite_dir),
        cfg,
        workspace_root=Path("/tmp/kairo-eval-basics"),
    )
    print()
    print(format_report(report))
    # Save JSON.
    out_path = Path("/tmp/kairo-eval-basics-report.json")
    out_path.write_text(json.dumps(report.to_dict(), indent=2))
    print(f"\nReport saved to {out_path}")
    return 0 if report.pass_rate >= 0.5 else 1


if __name__ == "__main__":
    sys.exit(main())
