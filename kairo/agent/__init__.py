"""Agent package — the loop, dispatcher, context, safety, memory, self-improve, reflexion, swarm, learning, persona, failover."""

from kairo.agent.agent import Agent, AgentConfig
from kairo.agent.context import (
    ContextManager,
    estimate_conversation_tokens,
    estimate_message_tokens,
    estimate_tokens,
)
from kairo.agent.dispatcher import DispatchResult, ToolDispatcher
from kairo.agent.failover import FailoverConfig, FailoverProvider, build_failover_chain
from kairo.agent.learning import LearningEntry, LearningGraph
from kairo.agent.memory import SessionStore, analyze_run
from kairo.agent.persona import Persona, default_persona, load_persona
from kairo.agent.reflexion import ReflexionResult, default_critic, llm_critic_factory, reflexion_run
from kairo.agent.safety import SafetyFilter
from kairo.agent.self_improve import (
    Suggestion,
    SuggestionKind,
    analyze_runs,
    format_suggestions,
)

__all__ = [
    "Agent",
    "AgentConfig",
    "ContextManager",
    "estimate_tokens",
    "estimate_message_tokens",
    "estimate_conversation_tokens",
    "ToolDispatcher",
    "DispatchResult",
    "SafetyFilter",
    "SessionStore",
    "analyze_run",
    "Suggestion",
    "SuggestionKind",
    "analyze_runs",
    "format_suggestions",
    "reflexion_run",
    "ReflexionResult",
    "default_critic",
    "llm_critic_factory",
    "LearningGraph",
    "LearningEntry",
    "Persona",
    "load_persona",
    "default_persona",
    "FailoverProvider",
    "FailoverConfig",
    "build_failover_chain",
]
