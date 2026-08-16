"""A model running on this machine, over Ollama's HTTP API.

Development against a metered API is a bad trade: the same prompt gets run
dozens of times while the shape of the output is still being argued with, and
none of those runs are worth money. A local model answers the same JSON contract
for nothing, which makes iterating on `prompts/*.md` free and keeps the paid key
for the surface a judge actually touches.

`httpx` again, so this adds no dependency. Ollama's `format: "json"` constrains
decoding to valid JSON, which matters more here than it does with a frontier
model: an 8B model asked politely for JSON will cheerfully wrap it in prose, and
`proposals.parse` would then fail the proposal for a formatting habit rather
than a bad judgement.

Quality is lower than the hosted models and that is the point — if a prompt only
works on a large model, it is relying on the model to be forgiving rather than
on being clear. Anything that survives an 8B local run is a better prompt.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Any

import httpx

from app.core.errors import ApiError
from app.features.ai.adapters.base import Completion

#: Local models are slower per token than the hosted ones and a cold model has
#: to be paged in first, so the read timeout is generous where the connect
#: timeout stays short — a refused connection means Ollama is not running, and
#: that should fail immediately rather than hang.
TIMEOUT = httpx.Timeout(connect=3.0, read=300.0, write=10.0, pool=5.0)


class OllamaAdapter:
    name = "ollama"

    def __init__(self, *, base_url: str, model: str) -> None:
        self._base_url = base_url.rstrip("/")
        self.model = model

    def _body(self, *, system: str, user: str, max_tokens: int, stream: bool) -> dict[str, Any]:
        return {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "stream": stream,
            # Constrained decoding. Without it a small model returns valid JSON
            # inside a sentence about how happy it is to help.
            "format": "json",
            "options": {"num_predict": max_tokens, "temperature": 0.2},
        }

    def _fail(self, status: int, body: str) -> ApiError:
        if status == 404:
            return ApiError(
                f"Ollama has no model named {self.model!r}. "
                f"Run `ollama pull {self.model}` or set AI_MODEL_DEFAULT to one you have.",
                code="AI_MODEL_MISSING",
            )
        return ApiError(f"The local model server refused the request ({status}): {body[:300]}")

    async def complete(self, *, system: str, user: str, max_tokens: int) -> Completion:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT) as client:
                response = await client.post(
                    f"{self._base_url}/api/chat",
                    json=self._body(system=system, user=user, max_tokens=max_tokens, stream=False),
                )
        except httpx.ConnectError as error:
            # The most likely failure by far, and the least obvious from a
            # stack trace: Ollama simply is not running.
            raise ApiError(
                f"No local model server at {self._base_url}. Start Ollama, or clear "
                "OLLAMA_BASE_URL to fall back to the hosted model.",
                code="AI_LOCAL_UNREACHABLE",
            ) from error

        if response.status_code != 200:
            raise self._fail(response.status_code, response.text)

        payload = response.json()
        return Completion(
            text=payload.get("message", {}).get("content", ""),
            model=f"ollama:{payload.get('model', self.model)}",
            # Ollama reports counts under different names than the hosted API.
            # Normalised here so a proposal row means the same thing whichever
            # adapter produced it.
            usage={
                "input_tokens": int(payload.get("prompt_eval_count", 0)),
                "output_tokens": int(payload.get("eval_count", 0)),
            },
        )

    async def stream(self, *, system: str, user: str, max_tokens: int) -> AsyncIterator[str]:
        async with (
            httpx.AsyncClient(timeout=TIMEOUT) as client,
            client.stream(
                "POST",
                f"{self._base_url}/api/chat",
                json=self._body(system=system, user=user, max_tokens=max_tokens, stream=True),
            ) as response,
        ):
            if response.status_code != 200:
                raise self._fail(response.status_code, (await response.aread()).decode("replace"))
            # Ollama streams newline-delimited JSON objects, not SSE frames.
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                fragment = event.get("message", {}).get("content", "")
                if fragment:
                    yield fragment
