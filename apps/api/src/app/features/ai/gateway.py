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
from app.features.ai.adapters.stub import StubAdapter

__all__ = ["Completion", "LLMAdapter", "select_adapter"]


def select_adapter() -> LLMAdapter:
    """A real adapter when a key exists, the stub otherwise.

    Falling back rather than raising is deliberate and is documented on
    `Settings.ai_enabled`: a missing key is the normal state of a fresh clone,
    not an error condition.
    """
    settings = get_settings()
    if settings.ai_enabled:
        return AnthropicAdapter(api_key=settings.anthropic_api_key, model=settings.ai_model_default)
    return StubAdapter(model=settings.ai_model_default)
