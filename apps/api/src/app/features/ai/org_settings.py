"""The org key (spec 0003): an organization's own model API key, and its cap.

Three operations — status, set, remove — and one property that shapes all of
them: the key is **write-only**. It is sealed on the way in, `last4` and
provenance are stamped so status never unseals anything, and no response or
audit row ever carries it back out.

The org picks a **provider preset** (Anthropic, OpenAI, Google, xAI, DeepSeek,
Kimi, Groq, Together — see `gateway.PROVIDERS`); the base URL is fixed per
preset, never typed, because an org-supplied URL would be an SSRF primitive on
the shared box. Validation happens before persistence, with the session
committed and closed around the provider round-trip, so a saved key is a
working key and a typo fails in front of the admin who pasted it.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

import anyio
import httpx
from fastapi import APIRouter, Depends, Path, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.core.config import get_settings
from app.core.crypto import seal
from app.core.deps import CurrentUser, DbSession, require_org_role
from app.core.errors import ApiError
from app.features.ai.gateway import PROVIDERS, OrgAiConfig, adapter_for
from app.features.ai.local_url import LocalUrlError, resolve_local_base_url
from app.models import ActivityLog, Organization, Role, User

#: The one preset with no API key and an org-supplied address (spec 0006).
LOCAL_PROVIDER = "ollama"

router = APIRouter(prefix="/v1/orgs/{org_id}/ai-key", tags=["ai"])

MANAGE = (Role.OWNER, Role.ADMIN)


class InvalidOrgKeyError(ApiError):
    status_code = 422
    code = "INVALID_ORG_KEY"


class ProviderOption(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    model_hint: str
    #: False for the local provider, which has no key and takes an address
    #: instead. The panel draws a different form rather than guessing.
    needs_key: bool = True


class OrgKeyStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")

    configured: bool
    provider: str | None
    model: str | None
    last4: str | None
    set_by_name: str | None
    set_at: datetime | None
    daily_cap: int | None
    #: Only set for the local provider; the screen shows it in the status line
    #: so "which model answered" is answerable without opening the form.
    base_url: str | None
    daily_cap_placeholder: int | None = None
    cap_default: int
    #: The preset table, so the screen never hardcodes a provider list.
    providers: list[ProviderOption]


class OrgKeyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Optional so the cap is settable without re-pasting a key that is already
    #: working. Sending neither field is a no-op and harmless.
    api_key: str | None = Field(default=None, min_length=8, max_length=512)
    provider: str | None = None
    model: str | None = Field(default=None, min_length=1, max_length=120)
    #: Required for the local provider, meaningless for every other one.
    base_url: str | None = Field(default=None, max_length=300)
    daily_cap: int | None = Field(default=None, ge=0, le=1_000_000)


async def verify_config(config: OrgAiConfig) -> None:
    """One minimal call with the candidate configuration, through the same
    adapter a real request would use. Raises with the provider's own reason on
    refusal — it names bad keys specifically, which is the part the admin needs
    to read. The candidate key is never logged; see security.md."""
    adapter = adapter_for(config)
    try:
        with anyio.fail_after(20):
            await adapter.complete(system="", user="ping", max_tokens=1)
    except ApiError as refusal:
        raise InvalidOrgKeyError(str(refusal)) from refusal
    except (httpx.HTTPError, TimeoutError) as error:
        raise InvalidOrgKeyError(
            f"Could not reach the model provider to check the key: {type(error).__name__}."
        ) from error


def _resolve_provider(body: OrgKeyUpdate) -> str:
    provider = body.provider or "anthropic"
    if provider not in PROVIDERS:
        known = ", ".join(sorted(PROVIDERS))
        raise InvalidOrgKeyError(f"Unknown provider {provider!r}. One of: {known}.")
    # Anthropic has a server-side default model; nobody else can — there is no
    # sane cross-provider fallback, so the org names what it is paying for.
    if provider != "anthropic" and not body.model:
        raise InvalidOrgKeyError(
            f"A model name is required for {PROVIDERS[provider].label} — for example "
            f"{PROVIDERS[provider].model_hint!r}."
        )
    return provider


async def _org(session: DbSession, org_id: uuid.UUID) -> Organization:
    org = await session.get(Organization, org_id)
    if org is None:  # pragma: no cover - the role gate already proved membership
        raise ApiError("No such organisation.", status_code=404, code="NOT_FOUND")
    return org


async def _status(session: DbSession, org: Organization) -> OrgKeyStatus:
    set_by_name: str | None = None
    if org.ai_key_set_by is not None:
        set_by_name = await session.scalar(select(User.name).where(User.id == org.ai_key_set_by))
    return OrgKeyStatus(
        # "Configured" now means a provider was chosen, not that a key exists —
        # the local provider is fully configured with no key at all.
        configured=org.ai_provider is not None,
        provider=org.ai_provider,
        model=org.ai_model,
        last4=org.ai_key_last4,
        set_by_name=set_by_name,
        set_at=org.ai_key_set_at,
        base_url=org.ai_base_url,
        daily_cap=org.ai_daily_proposal_cap,
        cap_default=get_settings().ai_daily_proposal_cap,
        providers=[
            ProviderOption(
                id=key,
                label=preset.label,
                model_hint=preset.model_hint,
                needs_key=preset.protocol != "ollama",
            )
            for key, preset in PROVIDERS.items()
        ],
    )


@router.get("", response_model=OrgKeyStatus)
async def key_status(
    session: DbSession,
    org_id: Annotated[uuid.UUID, Path()],
    _: Role = Depends(require_org_role(*MANAGE)),
) -> OrgKeyStatus:
    return await _status(session, await _org(session, org_id))


@router.put("", response_model=OrgKeyStatus)
async def set_key(
    body: OrgKeyUpdate,
    session: DbSession,
    user: CurrentUser,
    org_id: Annotated[uuid.UUID, Path()],
    _: Role = Depends(require_org_role(*MANAGE)),
) -> OrgKeyStatus:
    # A provider or model without a key is a half-configuration: the key
    # belongs to a provider, so changing one without the other cannot be
    # honoured — refused rather than silently ignored (fail loud, code-style).
    # The local provider has no key to paste, so "did they send a key" cannot be
    # what decides whether this is a reconfiguration. `provider` is.
    is_local = (body.provider or "") == LOCAL_PROVIDER
    reconfiguring = body.api_key is not None or is_local

    if not reconfiguring and (body.provider is not None or body.model is not None):
        raise InvalidOrgKeyError(
            "Changing the provider or model requires pasting the key again — "
            "the key is stored against the provider it belongs to."
        )
    if is_local:
        if body.model is None:
            raise InvalidOrgKeyError(
                "Choose which model on that server to use — the local providers "
                "each carry several and there is no sensible default."
            )
        try:
            base_url = resolve_local_base_url(body.base_url or "")
        except LocalUrlError as error:
            raise InvalidOrgKeyError(str(error)) from error
    if reconfiguring:
        provider = _resolve_provider(body)
        # A session never spans an external network call (architecture.md).
        # The auth and role dependencies have already opened this request's
        # transaction, so it is committed and the connection released before
        # the provider round-trip; the persistence below begins a fresh, short
        # transaction. A refused key therefore holds nothing open and leaves
        # no trace of having been offered.
        await session.commit()
        await session.close()
        await verify_config(
            OrgAiConfig(
                provider=provider,
                api_key=body.api_key or "",
                model=body.model,
                base_url=base_url if is_local else None,
            )
        )

    org = await _org(session, org_id)
    if reconfiguring:
        # A local server has no key, so the sealed column is cleared rather
        # than left holding the previous provider's credential.
        org.ai_key_encrypted = seal(body.api_key) if body.api_key is not None else None
        org.ai_key_last4 = body.api_key[-4:] if body.api_key is not None else None
        org.ai_provider = _resolve_provider(body)
        org.ai_model = body.model
        org.ai_base_url = base_url if is_local else None
        org.ai_key_set_by = user.id
        org.ai_key_set_at = datetime.now(UTC)
        session.add(
            ActivityLog(
                org_id=org.id,
                actor_user_id=user.id,
                entity_type="organization",
                entity_id=org.id,
                action="ai_key.set",
                # last4 and provider only — the audit trail is as write-only
                # as the API.
                changes={"last4": org.ai_key_last4, "provider": org.ai_provider},
            )
        )
    if body.daily_cap is not None:
        org.ai_daily_proposal_cap = body.daily_cap
    await session.flush()
    return await _status(session, org)


@router.delete("", response_model=OrgKeyStatus)
async def remove_key(
    session: DbSession,
    user: CurrentUser,
    org_id: Annotated[uuid.UUID, Path()],
    _: Role = Depends(require_org_role(*MANAGE)),
) -> OrgKeyStatus:
    org = await _org(session, org_id)
    org.ai_key_encrypted = None
    org.ai_key_last4 = None
    org.ai_provider = None
    org.ai_model = None
    org.ai_key_set_by = None
    org.ai_key_set_at = None
    # The cap survives on purpose: it is the org's ceiling, not the key's.
    session.add(
        ActivityLog(
            org_id=org.id,
            actor_user_id=user.id,
            entity_type="organization",
            entity_id=org.id,
            action="ai_key.removed",
            changes={},
        )
    )
    await session.flush()
    return await _status(session, org)


class LocalModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    size_bytes: int | None = None


class LocalModels(BaseModel):
    model_config = ConfigDict(extra="forbid")

    models: list[LocalModel]


@router.get("/local-models", response_model=LocalModels)
async def list_local_models(
    base_url: Annotated[str, Query(max_length=300)],
    org_id: Annotated[uuid.UUID, Path()],
    _: Role = Depends(require_org_role(*MANAGE)),
) -> LocalModels:
    """What is actually installed on that server.

    So the model becomes a dropdown of things that exist rather than a text
    field you find out was wrong on your first question. Same address
    restriction as saving — this is a server-side fetch of a user-supplied URL,
    which is the exact shape `local_url` exists to constrain, and being a
    read-only convenience does not make it less of one.
    """
    try:
        target = resolve_local_base_url(base_url)
    except LocalUrlError as error:
        raise InvalidOrgKeyError(str(error)) from error

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=3.0)) as client:
            # No redirects: a 302 towards a metadata endpoint is the whole attack.
            response = await client.get(f"{target}/api/tags", follow_redirects=False)
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPError as error:
        raise InvalidOrgKeyError(
            f"Could not reach a model server at {target} — {error.__class__.__name__}. "
            "Check the address, and that the server is running."
        ) from error

    found = payload.get("models", []) if isinstance(payload, dict) else []
    return LocalModels(
        models=[
            LocalModel(name=str(entry["name"]), size_bytes=entry.get("size"))
            for entry in found
            if isinstance(entry, dict) and entry.get("name")
        ]
    )
