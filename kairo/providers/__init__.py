"""Provider package — imports all builtin providers so they self-register."""

from __future__ import annotations

from kairo.config import KairoConfig, ProviderConfig
from kairo.errors import ProviderUnavailable
from kairo.providers.base import (
    Provider,
    available_providers,
    get_provider_class,
    register_provider,
)
from kairo.utils import get_logger

log = get_logger("provider")

# Importing these modules registers them via the @register_provider decorator.
from kairo.providers import anthropic as _anthropic  # noqa: F401
from kairo.providers import glm as _glm  # noqa: F401
from kairo.providers import hermes_xml as _hermes_xml  # noqa: F401
from kairo.providers import ollama as _ollama  # noqa: F401
from kairo.providers import openai as _openai  # noqa: F401
from kairo.providers import openrouter as _openrouter  # noqa: F401


def build_provider(name: str, cfg: KairoConfig) -> Provider:
    """Instantiate a Provider by name, using config from ``cfg``."""
    if name not in cfg.providers:
        raise ProviderUnavailable(name, f"no provider config for {name!r}")
    pcfg = cfg.providers[name]
    if not pcfg.enabled:
        raise ProviderUnavailable(name, f"provider {name!r} is disabled in config")
    cls = get_provider_class(name)
    return cls(pcfg)


def build_all_enabled(cfg: KairoConfig) -> dict[str, Provider]:
    """Build every enabled provider, returning a name -> Provider map."""
    out: dict[str, Provider] = {}
    for name, pcfg in cfg.providers.items():
        if not pcfg.enabled:
            continue
        try:
            out[name] = build_provider(name, cfg)
        except Exception as exc:  # noqa: BLE001
            log.warning("could not build provider %s: %s", name, exc)
    return out


__all__ = [
    "Provider",
    "build_provider",
    "build_all_enabled",
    "available_providers",
    "get_provider_class",
    "register_provider",
]
