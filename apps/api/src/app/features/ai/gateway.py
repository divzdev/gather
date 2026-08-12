"""The only door between this application and a language model.

Feature code imports `select_adapter`. It never imports `httpx`, never sees an
API key, and never learns which provider answered — which is what keeps the
zero-credential path from being a special case bolted on afterwards. With no key
configured the stub answers and everything downstream behaves identically.
"""

from __future__ import annotations

from app.core.config import get_settings
from app.features.ai.adapters.anthropic import AnthropicAdapter
from app.features.ai.adapters.base import Completion, LLMAdapter
from app.features.ai.adapters.ollama import OllamaAdapter
from app.features.ai.adapters.stub import StubAdapter

__all__ = ["Completion", "LLMAdapter", "select_adapter"]


def select_adapter() -> LLMAdapter:
    """Local model, then hosted model, then the stub. In that order, deliberately.

    A local server outranks a paid key because development runs the same prompt
    dozens of times and none of those runs are worth money — so the cheap thing
    is the default whenever it is available, and the key is reserved for the
    surface a real user touches. Production sets no `OLLAMA_BASE_URL`, which is
    what keeps that arrangement honest rather than accidental.

    Falling through to the stub rather than raising is documented on
    `Settings.ai_enabled`: no credentials at all is the normal state of a fresh
    clone, not an error.
    """
    settings = get_settings()
    if settings.ollama_base_url:
        return OllamaAdapter(base_url=settings.ollama_base_url, model=settings.ollama_model)
    if settings.ai_enabled:
        return AnthropicAdapter(api_key=settings.anthropic_api_key, model=settings.ai_model_default)
    return StubAdapter(model=settings.ai_model_default)
