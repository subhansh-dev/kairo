#!/usr/bin/env python3
"""Streaming smoke test — shows tokens arriving live from GLM."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from kairo.providers.streaming import (
    StreamEvent,
    assemble_stream,
    stream_openai_compat,
)


def main() -> int:
    # Load ZAI config.
    with open("/etc/.z-ai-config") as f:
        zcfg = json.load(f)
    base_url = zcfg["baseUrl"]
    api_key = zcfg["apiKey"]
    token = zcfg["token"]
    chat_id = zcfg.get("chatId", "")
    user_id = zcfg.get("userId", "")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        "X-Z-AI-From": "Z",
        "X-Token": token,
    }
    if chat_id:
        headers["X-Chat-Id"] = chat_id
    if user_id:
        headers["X-User-Id"] = user_id

    body = {
        "model": "glm-4.6",
        "messages": [
            {"role": "user", "content": "Count from 1 to 5 slowly, one per line."}
        ],
        "temperature": 0.0,
        "stream": True,
        "thinking": {"type": "disabled"},
    }

    print("=== streaming response ===")
    print("---")
    events = []
    for ev in stream_openai_compat(base_url=base_url, headers=headers, body=body):
        if ev.kind == "text_delta":
            print(ev.data, end="", flush=True)
            events.append(ev)
        elif ev.kind == "done":
            events.append(ev)
            print(f"\n--- [done: {ev.data}, usage={ev.usage}]")
        elif ev.kind == "error":
            print(f"\n[error: {ev.data}]")
            return 1
        else:
            events.append(ev)

    print("\n=== assembled ===")
    out = assemble_stream(iter(events))
    print(f"text: {out.text!r}")
    print(f"tool_calls: {len(out.tool_calls)}")
    print(f"finish_reason: {out.finish_reason}")
    print(f"usage: {out.usage}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
