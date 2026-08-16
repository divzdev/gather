"""What every model provider must look like from inside this application.

Two implementations exist and both are load-bearing: `anthropic` talks to a real
model, and `stub` is what makes `make setup && make dev` produce a working app
with zero credentials — a graded deliverable, not a convenience. That second
implementation is why this Protocol is a Protocol rather than a class with one
subclass nobody needed.

Adapters return *text*. They do not parse it, validate it, or know what a rubric
is. Turning a model's answer into something this product can act on happens in
`proposals.py`, against a Pydantic schema, so that a malformed reply is a failed
proposal item with a readable reason instead of an exception in a provider
client.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True, slots=True)
class Completion:
    """One model answer, plus what it cost and who produced it."""

    text: str
    model: str
    #: `{"input_tokens": n, "output_tokens": n}`. Empty from the stub, which
    #: spends nothing — recorded on the proposal either way so the row never
    #: has to be interpreted differently depending on the adapter.
    usage: dict[str, int] = field(default_factory=dict)
    #: True when no model was involved. The UI has to say so; presenting
    #: deterministic filler as reasoning is the dishonesty this whole feature is
    #: most at risk of.
    is_stub: bool = False


class LLMAdapter(Protocol):
    """The only shape feature code ever sees. Nothing imports a provider SDK."""

    #: The wire protocol — "anthropic", "openai-compat", "ollama", "stub".
    name: str

    #: Which model this adapter will ask, before it has been asked anything.
    #: Public because the screen has to name it *during* the wait: `Completion`
    #: carries the model too, but only once an answer has come back, and "which
    #: model is this slow request on" is a question asked before then.
    model: str

    async def complete(self, *, system: str, user: str, max_tokens: int) -> Completion:
        """Answer in one round trip."""
        ...

    def stream(self, *, system: str, user: str, max_tokens: int) -> AsyncIterator[str]:
        """Yield text fragments as they arrive.

        Returns the iterator rather than being an async generator itself, so an
        implementation is free to be either.
        """
        ...
