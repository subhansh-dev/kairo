"""Classic agent reasoning patterns: ReAct, ReWOO, Plan-and-Execute.

These are well-known patterns from the agent literature. Each is a thin
wrapper around Kairo's Agent + a different loop structure. They're
provided as building blocks — Kairo's default Agent loop is already a
generalization of ReAct, but sometimes you want the explicit structure.

Patterns:

  * **ReAct** (Reason + Act + Observe): the classic loop. Each turn the
    model produces a thought, an action (tool call), and observes the
    result before the next thought. Best for tasks where the model
    needs to react to tool outputs.

  * **ReWOO** (Reasoning WithOut Observation): plan-once-then-execute.
    The model produces a complete plan including all tool calls up
    front, then executes them without re-planning. Cheaper (fewer LLM
    calls) but less adaptive.

  * **Plan-and-Execute**: hybrid. A planner model produces a TODO
    list, an executor model works through each item, and a replanner
    can revise the plan if execution reveals surprises.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from kairo.agent import Agent, AgentConfig
from kairo.config import KairoConfig
from kairo.types import AgentResult, Message, Role
from kairo.utils import get_logger

log = get_logger("agent.patterns")


# ---------------------------------------------------------------------------
# ReAct — explicit think-act-observe loop
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class ReActStep:
    """One step in a ReAct trace."""

    thought: str
    action: str | None = None  # tool name, or None for final answer
    action_input: dict[str, Any] | None = None
    observation: str | None = None


@dataclass(slots=True)
class ReActResult:
    """Outcome of a ReAct run."""

    steps: list[ReActStep]
    final_answer: str
    duration_s: float
    iterations: int


def react_run(
    agent_cfg: AgentConfig,
    kairo_cfg: KairoConfig,
    user_message: str,
    *,
    max_iterations: int = 10,
) -> ReActResult:
    """Run a ReAct-style loop.

    Each iteration the model is asked to produce JSON with:
      * ``thought``: reasoning about the current state
      * ``action``: a tool name, or ``"FINAL_ANSWER"``
      * ``action_input``: arguments for the tool

    The loop runs the tool, appends the observation, and continues
    until the model emits ``FINAL_ANSWER`` or hits the iteration cap.
    """
    import json
    start = time.time()
    steps: list[ReActStep] = []
    system_prompt = (
        "You are a ReAct agent. For each step, respond with a single JSON "
        "object with three keys: 'thought' (your reasoning), 'action' (a tool "
        "name from the available tools, or 'FINAL_ANSWER' to stop), and "
        "'action_input' (a dict of arguments, or the final answer text). "
        "Do not produce any text outside the JSON object."
    )
    # Use the agent's tool list as the action space.
    from kairo.tools import ToolBundleConfig, build_default_registry
    bundle = ToolBundleConfig(workspace=agent_cfg.workspace)
    registry, guard, _ = build_default_registry(bundle)
    tool_names = registry.names()
    system_prompt += f"\n\nAvailable tools: {', '.join(tool_names)}"

    messages: list[Message] = [
        Message(role=Role.SYSTEM, content=system_prompt),
        Message(role=Role.USER, content=user_message),
    ]
    final_answer = ""
    for i in range(max_iterations):
        agent = Agent(kairo_cfg, AgentConfig(
            workspace=agent_cfg.workspace,
            system_prompt=system_prompt,
            max_turns=1,
            use_learning_hint=False,
        ))
        # Skip the agent's own loop; we just need one provider call.
        # Build a minimal request and call the first available provider.
        from kairo.providers import build_all_enabled
        providers = build_all_enabled(kairo_cfg)
        if not providers:
            raise RuntimeError("no providers available")
        provider = next(iter(providers.values()))
        resp = provider.complete(messages=messages, tools=None)
        text = resp.content.strip()
        # Parse the JSON.
        try:
            step_data = json.loads(text)
        except json.JSONDecodeError:
            # Model didn't follow format — treat as final answer.
            final_answer = text
            break
        thought = str(step_data.get("thought", ""))
        action = str(step_data.get("action", "FINAL_ANSWER"))
        action_input = step_data.get("action_input", {}) or {}

        if action == "FINAL_ANSWER":
            final_answer = str(action_input) if not isinstance(action_input, dict) else json.dumps(action_input)
            steps.append(ReActStep(thought=thought, action=None))
            break

        # Execute the tool.
        observation = ""
        if registry.has(action):
            try:
                rt = registry.get(action)
                if rt.is_async:
                    import asyncio
                    observation = str(asyncio.new_event_loop().run_until_complete(rt.fn(action_input)))
                else:
                    observation = str(rt.fn(**action_input))
            except Exception as exc:  # noqa: BLE001
                observation = f"ERROR: {exc}"
        else:
            observation = f"ERROR: unknown tool {action!r}"

        steps.append(ReActStep(
            thought=thought, action=action,
            action_input=action_input, observation=observation,
        ))
        # Append to messages for next iteration.
        messages.append(Message(role=Role.ASSISTANT, content=text))
        messages.append(Message(role=Role.USER, content=f"Observation: {observation}"))
    else:
        final_answer = "(ReAct loop hit iteration cap without final answer)"

    return ReActResult(
        steps=steps,
        final_answer=final_answer,
        duration_s=time.time() - start,
        iterations=len(steps),
    )


# ---------------------------------------------------------------------------
# ReWOO — plan-once, execute without observation
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class ReWOOSlot:
    """One slot in a ReWOO plan."""

    step_id: str  # e.g. "E_1"
    description: str
    tool: str | None = None
    args: dict[str, Any] = field(default_factory=dict)
    depends_on: list[str] = field(default_factory=list)
    # Filled in during execution.
    result: str | None = None


@dataclass(slots=True)
class ReWOOResult:
    plan: list[ReWOOSlot]
    final_answer: str
    duration_s: float
    planner_calls: int
    solver_calls: int


def rewoo_run(
    agent_cfg: AgentConfig,
    kairo_cfg: KairoConfig,
    user_message: str,
) -> ReWOOResult:
    """Run a ReWOO loop: plan once, execute, then solve.

    1. Planner produces a list of slots: ``E_1: <tool> <args> #depends on E_0``
    2. Executor runs each slot's tool, substituting ``#E_n`` references
       with the prior slot's result.
    3. Solver takes all slot results + original query, produces answer.
    """
    import json
    import re
    start = time.time()
    from kairo.tools import ToolBundleConfig, build_default_registry
    from kairo.providers import build_all_enabled

    bundle = ToolBundleConfig(workspace=agent_cfg.workspace)
    registry, _, _ = build_default_registry(bundle)
    tool_names = registry.names()

    planner_prompt = (
        "You are a ReWOO planner. Produce a JSON array of tool-call slots "
        "to answer the user's request. Each slot is an object with: "
        "'step_id' (e.g. 'E_1'), 'tool' (one of: " + ", ".join(tool_names) + "), "
        "'args' (a dict of arguments), and 'depends_on' (a list of step_ids "
        "whose results should be substituted into args). Use '#E_n' as a "
        "placeholder in args values where a prior slot's result should go. "
        "Respond with ONLY the JSON array, no other text."
    )

    providers = build_all_enabled(kairo_cfg)
    provider = next(iter(providers.values()))

    # 1. Plan.
    plan_resp = provider.complete(messages=[
        Message(role=Role.SYSTEM, content=planner_prompt),
        Message(role=Role.USER, content=user_message),
    ])
    try:
        plan_data = json.loads(plan_resp.content.strip())
    except json.JSONDecodeError:
        return ReWOOResult(
            plan=[], final_answer="(planner did not produce valid JSON)",
            duration_s=time.time() - start, planner_calls=1, solver_calls=0,
        )

    slots: list[ReWOOSlot] = []
    for raw in plan_data:
        slots.append(ReWOOSlot(
            step_id=str(raw.get("step_id", f"E_{len(slots) + 1}")),
            description=str(raw.get("description", "")),
            tool=raw.get("tool"),
            args=raw.get("args", {}) or {},
            depends_on=raw.get("depends_on", []) or [],
        ))

    # 2. Execute slots in order, substituting #E_n references.
    results_by_id: dict[str, str] = {}
    for slot in slots:
        # Substitute #E_n references in args.
        args_str = json.dumps(slot.args)
        for dep_id in slot.depends_on:
            dep_result = results_by_id.get(dep_id, "")
            args_str = args_str.replace(f"#{dep_id}", dep_result.replace('"', '\\"'))
        try:
            slot.args = json.loads(args_str)
        except json.JSONDecodeError:
            pass  # keep original args
        if slot.tool and registry.has(slot.tool):
            try:
                rt = registry.get(slot.tool)
                if rt.is_async:
                    import asyncio
                    result = str(asyncio.new_event_loop().run_until_complete(rt.fn(slot.args)))
                else:
                    result = str(rt.fn(**slot.args))
            except Exception as exc:  # noqa: BLE001
                result = f"ERROR: {exc}"
        else:
            result = f"(no tool {slot.tool!r})"
        slot.result = result
        results_by_id[slot.step_id] = result

    # 3. Solve.
    solver_prompt = (
        "You are a ReWOO solver. Given the user's request and the results "
        "of each tool call, produce a final answer.\n\n"
        f"Request: {user_message}\n\n"
        "Slot results:\n" +
        "\n".join(f"- {s.step_id}: {s.result}" for s in slots) +
        "\n\nRespond with the final answer."
    )
    solver_resp = provider.complete(messages=[
        Message(role=Role.SYSTEM, content=solver_prompt),
    ])
    final_answer = solver_resp.content.strip()

    return ReWOOResult(
        plan=slots,
        final_answer=final_answer,
        duration_s=time.time() - start,
        planner_calls=1,
        solver_calls=1,
    )


# ---------------------------------------------------------------------------
# Plan-and-Execute — planner makes TODOs, executor works through them
# ---------------------------------------------------------------------------

@dataclass(slots=True)
class PlanAndExecuteResult:
    plan: list[str]
    final_answer: str
    duration_s: float
    replans: int


def plan_and_execute_run(
    agent_cfg: AgentConfig,
    kairo_cfg: KairoConfig,
    user_message: str,
    *,
    max_replans: int = 1,
    max_steps: int = 10,
) -> PlanAndExecuteResult:
    """Run a plan-and-execute loop.

    1. Planner produces a numbered list of steps.
    2. Executor works through each step as a sub-agent.
    3. (Optional) Replanner revises the plan if executor reports issues.
    """
    import re
    start = time.time()
    from kairo.providers import build_all_enabled
    providers = build_all_enabled(kairo_cfg)
    provider = next(iter(providers.values()))

    # 1. Plan.
    plan_resp = provider.complete(messages=[
        Message(role=Role.SYSTEM, content=(
            "You are a planner. Decompose the user's request into a numbered "
            "list of concrete, executable steps. Respond with ONLY the list, "
            "one step per line, format: 'N. step description'."
        )),
        Message(role=Role.USER, content=user_message),
    ])
    plan_text = plan_resp.content.strip()
    plan = [
        re.sub(r"^\d+\.\s*", "", line).strip()
        for line in plan_text.splitlines()
        if re.match(r"^\s*\d+\.\s", line)
    ]
    if not plan:
        return PlanAndExecuteResult(
            plan=[], final_answer="(planner produced no steps)",
            duration_s=time.time() - start, replans=0,
        )

    # 2. Execute each step as a sub-agent.
    executor_history: list[str] = []
    replans = 0
    for i, step in enumerate(plan[:max_steps]):
        sub_agent = Agent(kairo_cfg, AgentConfig(
            workspace=agent_cfg.workspace,
            system_prompt=(
                f"You are an executor. Execute this step: {step}\n\n"
                "Prior context:\n" + "\n".join(executor_history[-3:]) if executor_history else ""
            ),
            max_turns=5,
        ))
        result = sub_agent.run(step)
        last_text = ""
        for m in reversed(result.messages):
            if m.role == Role.ASSISTANT and m.content:
                last_text = m.content
                break
        executor_history.append(f"Step {i + 1}: {step}\nResult: {last_text[:500]}")

    # 3. Solve / synthesize.
    final_resp = provider.complete(messages=[
        Message(role=Role.SYSTEM, content=(
            "You are a synthesizer. Given the original request and the "
            "executor's outputs, produce the final answer."
        )),
        Message(role=Role.USER, content=(
            f"Original request: {user_message}\n\n"
            "Executor outputs:\n" + "\n\n".join(executor_history)
        )),
    ])
    final_answer = final_resp.content.strip()

    return PlanAndExecuteResult(
        plan=plan,
        final_answer=final_answer,
        duration_s=time.time() - start,
        replans=replans,
    )
