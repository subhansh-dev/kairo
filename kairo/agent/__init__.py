"""Agent package — full agent suite.

Includes: agent loop, dispatcher, context, safety, memory, self-improve,
reflexion, swarm, learning, persona, failover, cascade, graph, patterns
(ReAct/ReWOO/Plan-and-Execute), structured output, A2A protocol, code sandbox.
"""

from kairo.agent.a2a import A2AClient, A2AMessage, A2AServer, AgentCard
from kairo.agent.agent import Agent, AgentConfig
from kairo.agent.cascade import (
    CascadeConfig,
    CascadeResult,
    CascadeRouter,
    build_cascade_from_catalog,
    default_confidence_scorer,
)
from kairo.agent.code_sandbox import CodeSandbox, SandboxResult
from kairo.agent.context import (
    ContextManager,
    estimate_conversation_tokens,
    estimate_message_tokens,
    estimate_tokens,
)
from kairo.agent.dispatcher import DispatchResult, ToolDispatcher
from kairo.agent.failover import FailoverConfig, FailoverProvider, build_failover_chain
from kairo.agent.graph import (
    END,
    START,
    Checkpoint,
    CompiledGraph,
    GraphError,
    State,
    StateGraph,
)
from kairo.agent.learning import LearningEntry, LearningGraph
from kairo.agent.memory import SessionStore, analyze_run
from kairo.agent.patterns import (
    PlanAndExecuteResult,
    ReActResult,
    ReActStep,
    ReWOOResult,
    ReWOOSlot,
    plan_and_execute_run,
    react_run,
    rewoo_run,
)
from kairo.agent.persona import Persona, default_persona, load_persona
from kairo.agent.reflexion import ReflexionResult, default_critic, llm_critic_factory, reflexion_run
from kairo.agent.safety import SafetyFilter
from kairo.agent.self_improve import (
    Suggestion,
    SuggestionKind,
    analyze_runs,
    format_suggestions,
)
from kairo.agent.structured import (
    StructuredResult,
    StructuredRunner,
    coerce_to_schema,
    parse_json_lenient,
    validate_against_schema,
)

__all__ = [
    # core
    "Agent", "AgentConfig",
    "ContextManager", "estimate_tokens", "estimate_message_tokens",
    "estimate_conversation_tokens",
    "ToolDispatcher", "DispatchResult",
    "SafetyFilter",
    "SessionStore", "analyze_run",
    "Suggestion", "SuggestionKind", "analyze_runs", "format_suggestions",
    "reflexion_run", "ReflexionResult", "default_critic", "llm_critic_factory",
    "LearningGraph", "LearningEntry",
    "Persona", "load_persona", "default_persona",
    "FailoverProvider", "FailoverConfig", "build_failover_chain",
    # graph
    "StateGraph", "CompiledGraph", "State", "Checkpoint", "GraphError", "START", "END",
    # patterns
    "react_run", "ReActResult", "ReActStep",
    "rewoo_run", "ReWOOResult", "ReWOOSlot",
    "plan_and_execute_run", "PlanAndExecuteResult",
    # cascade
    "CascadeRouter", "CascadeConfig", "CascadeResult",
    "build_cascade_from_catalog", "default_confidence_scorer",
    # structured
    "StructuredRunner", "StructuredResult",
    "parse_json_lenient", "validate_against_schema", "coerce_to_schema",
    # A2A
    "A2AServer", "A2AClient", "A2AMessage", "AgentCard",
    # code sandbox
    "CodeSandbox", "SandboxResult",
]
