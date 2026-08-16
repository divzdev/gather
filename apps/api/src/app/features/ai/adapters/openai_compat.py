"""The OpenAI chat-completions protocol — one adapter, many providers.

OpenAI, Google (Gemini's compatibility endpoint), xAI, DeepSeek, Moonshot
(Kimi), Groq and Together all answer `POST {base_url}/chat/completions` with
the same request and response shapes; only the base URL and the model names
differ. That is why multi-provider support is this one class plus a preset
table in `org_settings`, and not an adapter per company.

Same contract as `AnthropicAdapter`: raise `ApiError` carrying the provider's
own words (they name bad keys and rate limits specifically), never log or echo
the key.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.core.errors import ApiError
from app.features.ai.adapters.base import Completion

#: Matches the Anthropic adapter's reasoning: models stream slowly, connects fail fast.
TIMEOUT = httpx.Timeout(connect=5.0, read=120.0, write=10.0, pool=5.0)


class OpenAICompatAdapter:
    name = "openai-compat"

    def __init__(self, *, base_url: str, api_key: str, model: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self.model = model

    def _headers(self) -> dict[str, str]:
        return {
            "authorization": f"Bearer {self._api_key}",
            "content-type": "application/json",
        }

    def _body(self, *, system: str, user: str, max_tokens: int, stream: bool) -> dict[str, Any]:
        messages: list[dict[str, str]] = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": user})
        return {
            "model": self.model,
            "max_tokens": max_tokens,
            "messages": messages,
            "stream": stream,
        }

    async def complete(self, *, system: str, user: str, max_tokens: int) -> Completion:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            response = await client.post(
                f"{self._base_url}/chat/completions",
                headers=self._headers(),
                json=self._body(system=system, user=user, max_tokens=max_tokens, stream=False),
            )
        if response.status_code != 200:
            raise ApiError(
                f"The model provider refused the request ({response.status_code}): "
                f"{response.text[:300]}"
            )

        payload = response.json()
        choices = payload.get("choices", [])
        message = choices[0].get("message", {}) if choices else {}
        usage = payload.get("usage", {})
        return Completion(
            text=str(message.get("content") or ""),
            model=str(payload.get("model", self.model)),
            usage={
                "input_tokens": int(usage.get("prompt_tokens", 0)),
                "output_tokens": int(usage.get("completion_tokens", 0)),
            },
        )

    async def stream(self, *, system: str, user: str, max_tokens: int) -> AsyncIterator[str]:
        """Yield delta text as it arrives, ignoring every non-text event.

        Same tolerance as the Anthropic adapter: unknown chunk shapes are
        skipped, not errors — providers add event types.
        """
        async with (
            httpx.AsyncClient(timeout=TIMEOUT) as client,
            client.stream(
                "POST",
                f"{self._base_url}/chat/completions",
                headers=self._headers(),
                json=self._body(system=system, user=user, max_tokens=max_tokens, stream=True),
            ) as response,
        ):
            if response.status_code != 200:
                body = (await response.aread()).decode(errors="replace")
                raise ApiError(
                    f"The model provider refused the request ({response.status_code}): {body[:300]}"
                )
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[len("data:") :].strip()
                if raw == "" or raw == "[DONE]":
                    continue
                try:
                    chunk = json.loads(raw)
                except ValueError:
                    continue
                choices = chunk.get("choices", [])
                delta = choices[0].get("delta", {}) if choices else {}
                text = delta.get("content")
                if isinstance(text, str) and text:
                    yield text
