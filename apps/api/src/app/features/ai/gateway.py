"""The only door between this application and a language model.

Feature code imports `select_adapter`. It never imports `httpx`, never sees an
API key, and never learns which provider answered — which is what keeps the
zero-credential path from being a special case bolted on afterwards. With no key
configured the stub answers and everything downstream behaves identically.

Two wire protocols cover every supported provider: the Anthropic Messages API,
and the OpenAI chat-completions protocol that OpenAI, Google (Gemini's
compatibility endpoint), xAI, DeepSeek, Moonshot (Kimi), Groq and Together all
speak at different base URLs. `PROVIDERS` is that map. Those base URLs are
code, not data, on purpose: an org-supplied URL is an SSRF primitive on the
shared box (cloud metadata endpoints, with response text echoed back through
our own error surface), so an org picks a preset and never types a URL.

The one exception is the local-model preset, where only the operator knows
where their own server is. It takes a URL and restricts it instead — see
`local_url`, which refuses anything that does not resolve to a private address.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.core.config import get_settings
from app.features.ai.adapters.anthropic import AnthropicAdapter
from app.features.ai.adapters.base import Completion, LLMAdapter
from app.features.ai.adapters.ollama import OllamaAdapter
from app.features.ai.adapters.openai_compat import OpenAICompatAdapter
from app.features.ai.adapters.stub import StubAdapter
from app.features.ai.local_url import resolve_local_base_url

__all__ = ["PROVIDERS", "Completion", "LLMAdapter", "OrgAiConfig", "Provider", "select_adapter"]


@dataclass(frozen=True, slots=True)
class Provider:
    """One preset: a label for the screen, a wire protocol, a fixed base URL,
    and a placeholder model name (a hint, never a default — the org names its
    model, because there is no sane cross-provider fallback)."""

    label: str
    protocol: str  # "anthropic" | "openai" | "ollama"
    base_url: str | None
    model_hint: str


PROVIDERS: dict[str, Provider] = {
    "anthropic": Provider("Anthropic", "anthropic", None, "claude-sonnet-4-5"),
    "openai": Provider("OpenAI", "openai", "https://api.openai.com/v1", "gpt-4o-mini"),
    "meta": Provider(
        # The contributor tier is the cheap one, and the hint says so — but
        # cheap because prompts may feed training, so the Settings card warns
        # when a model name carries the -contributor suffix.
        "Meta Muse Spark",
        "openai",
        "https://api.meta.ai/v1",
        "muse-spark-1.2-contributor",
    ),
    "google": Provider(
        "Google Gemini",
        "openai",
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "gemini-2.0-flash",
    ),
    "xai": Provider("xAI Grok", "openai", "https://api.x.ai/v1", "grok-3-mini"),
    "deepseek": Provider("DeepSeek", "openai", "https://api.deepseek.com/v1", "deepseek-chat"),
    "moonshot": Provider(
        "Moonshot Kimi", "openai", "https://api.moonshot.ai/v1", "kimi-k2-0711-preview"
    ),
    "groq": Provider(
        "Groq (Llama)", "openai", "https://api.groq.com/openai/v1", "llama-3.3-70b-versatile"
    ),
    # The only preset whose base URL is not code: nobody but the operator knows
    # where their own machine is. It is restricted instead — see `local_url`.
    "ollama": Provider("Local model (Ollama)", "ollama", None, "llama3.1:8b"),
    "together": Provider(
        "Together (Llama & open models)",
        "openai",
        "https://api.together.xyz/v1",
        "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    ),
}


@dataclass(frozen=True, slots=True)
class OrgAiConfig:
    """What an organization configured: its own key, on which preset, asking
    for which model. Built by the AI service from the current tenant; consumed
    only here."""

    provider: str
    api_key: str
    model: str | None
    #: Only for the local preset, where the address is the org's to supply.
    base_url: str | None = None


def adapter_for(config: OrgAiConfig) -> LLMAdapter:
    """The adapter an org's configuration names. Raises KeyError on a provider
    the preset table does not know — which the settings surface refuses to
    store, so reaching that is a programming error, not user input."""
    preset = PROVIDERS[config.provider]
    model = config.model or get_settings().ai_model_default
    if preset.protocol == "ollama":
        # Re-resolved here, not trusted from storage: a name that resolved to a
        # private address when it was saved can resolve to a public one now.
        return OllamaAdapter(base_url=resolve_local_base_url(config.base_url or ""), model=model)
    if preset.protocol == "anthropic":
        return AnthropicAdapter(api_key=config.api_key, model=model)
    assert preset.base_url is not None  # every openai-protocol preset carries one
    return OpenAICompatAdapter(base_url=preset.base_url, api_key=config.api_key, model=model)


def select_adapter(*, org: OrgAiConfig | None = None) -> LLMAdapter:
    """What the organisation chose, then the server's key, then the stub.

    **`OLLAMA_BASE_URL` used to be checked first, unconditionally, and that was
    wrong** (spec 0006, after a real report). An organisation pasted a paid key
    into Settings, the panel said "every AI suggestion in this organisation runs
    on this key", and every suggestion ran on the local llama instead — with
    nothing on any screen to reveal it.

    The fix is not a different order. It is that **nothing here decides which
    model answers**. The local model is now the tenth entry in `PROVIDERS`,
    chosen on the same screen as the other nine, and this function reads that
    choice rather than second-guessing it. An org that has chosen nothing gets
    the stub, which is honest about being a stub — the old behaviour was a real
    model impersonating the configured one.

    The org's configuration (spec 0003) outranks the server's key because the
    org asked for it and pays for it: on the hosted install the server key does
    not exist at all, and for a self-hoster who has one, an org that configured
    its own has said whose bill this is.

    Falling through to the stub rather than raising is documented on
    `Settings.ai_enabled`: no credentials at all is the normal state of a fresh
    clone, not an error.
    """
    settings = get_settings()
    if org is not None:
        return adapter_for(org)
    if settings.ai_enabled:
        return AnthropicAdapter(api_key=settings.anthropic_api_key, model=settings.ai_model_default)
    return StubAdapter(model=settings.ai_model_default)
