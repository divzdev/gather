"""Message templates, and the one resolver that fills them in.

Eighty personal emails should be one piece of writing. `MessageTemplate` has
been in the schema since the first migration with no route touching it, so an
organiser writing to their speakers wrote to each of them.

The resolver is deliberately the only one: a preview that used different code
from the send would be a preview of nothing, and finding out the merge field was
wrong is the entire point of looking first.
"""

from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.deps import DbSession, bind_tenant, require_role
from app.core.errors import ApiError, NotFoundError
from app.core.tenancy import current_tenant
from app.models import (
    Event,
    EventSpeaker,
    MessagePurpose,
    MessageTemplate,
    Role,
    Session,
    SessionSpeaker,
    Speaker,
    User,
)

router = APIRouter(
    prefix="/v1/events/{event_id}/message-templates",
    tags=["messaging"],
    dependencies=[Depends(bind_tenant)],
)

READ = (Role.OWNER, Role.ADMIN, Role.COORDINATOR)
WRITE = (Role.OWNER, Role.ADMIN)

#: What a template may say, and what each one resolves to. Closed on purpose:
#: an open expression language in an email body is a template injection waiting
#: for the first organiser who pastes something in.
MERGE_FIELDS: dict[str, str] = {
    "speaker_name": "The speaker's full name",
    "speaker_first_name": "Their first name, for a greeting",
    "speaker_email": "Their email address",
    "session_title": "Their session's title, or a note that they have none yet",
    "event_name": "This event's name",
    "portal_link": "The address of the speaker portal",
}

_TOKEN = re.compile(r"\{\{\s*([a-z_]+)\s*\}\}")


def unknown_fields(text: str) -> list[str]:
    """Tokens the resolver would leave standing. Reported at write time so a
    typo is a validation error rather than an email that says
    `Dear {{speaker_naem}}`."""
    return sorted({name for name in _TOKEN.findall(text) if name not in MERGE_FIELDS})


def render(text: str, values: dict[str, str]) -> str:
    return _TOKEN.sub(lambda match: values.get(match.group(1), match.group(0)), text)


async def values_for(session: AsyncSession, *, speaker: Speaker, event: Event) -> dict[str, str]:
    """Everything a template may name, for one recipient."""
    title = await session.scalar(
        select(Session.title)
        .join(SessionSpeaker, SessionSpeaker.session_id == Session.id)
        .where(SessionSpeaker.speaker_id == speaker.id)
        .order_by(Session.starts_at)
        .limit(1)
    )
    settings = get_settings()
    return {
        "speaker_name": speaker.name,
        "speaker_first_name": speaker.name.split(" ")[0],
        "speaker_email": speaker.email,
        "session_title": title or "your session",
        "event_name": event.name,
        "portal_link": f"{settings.web_origin}/portal",
    }


class TemplateRead(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True)

    id: uuid.UUID
    name: str
    purpose: MessagePurpose
    subject: str
    body_markdown: str


class TemplateWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    purpose: MessagePurpose = MessagePurpose.CUSTOM
    subject: str = Field(min_length=1, max_length=300)
    body_markdown: str = Field(min_length=1)


class MergeField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    token: str
    description: str


class Preview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    speaker_name: str
    subject: str
    body: str


def _check_tokens(body: TemplateWrite) -> None:
    bad = unknown_fields(body.subject) + unknown_fields(body.body_markdown)
    if bad:
        raise ApiError(
            f"{'{{'}{bad[0]}{'}}'} is not a merge field. "
            f"The ones this event knows are: {', '.join(sorted(MERGE_FIELDS))}.",
            code="UNKNOWN_MERGE_FIELD",
            status_code=422,
            field="body_markdown",
        )


@router.get("/merge-fields", response_model=list[MergeField])
async def list_merge_fields(_: User = Depends(require_role(*READ))) -> list[MergeField]:
    """What a template is allowed to say. The composer reads this rather than
    hard-coding a list that would drift from the resolver."""
    return [
        MergeField(token=f"{{{{{token}}}}}", description=description)
        for token, description in sorted(MERGE_FIELDS.items())
    ]


@router.get("", response_model=list[TemplateRead])
async def list_templates(
    session: DbSession, _: User = Depends(require_role(*READ))
) -> list[TemplateRead]:
    rows = (
        (await session.execute(select(MessageTemplate).order_by(MessageTemplate.name)))
        .scalars()
        .all()
    )
    return [TemplateRead.model_validate(row) for row in rows]


@router.post("", response_model=TemplateRead, status_code=201)
async def create_template(
    body: TemplateWrite, session: DbSession, _: User = Depends(require_role(*WRITE))
) -> TemplateRead:
    _check_tokens(body)
    tenant = current_tenant()
    template = MessageTemplate(
        event_id=tenant.event_id,
        name=body.name,
        purpose=body.purpose,
        subject=body.subject,
        body_markdown=body.body_markdown,
    )
    session.add(template)
    await session.flush()
    return TemplateRead.model_validate(template)


@router.patch("/{template_id}", response_model=TemplateRead)
async def update_template(
    template_id: uuid.UUID,
    body: TemplateWrite,
    session: DbSession,
    _: User = Depends(require_role(*WRITE)),
) -> TemplateRead:
    _check_tokens(body)
    template = await session.get(MessageTemplate, template_id)
    if template is None:
        raise NotFoundError(f"No template with id {template_id}.")
    template.name = body.name
    template.purpose = body.purpose
    template.subject = body.subject
    template.body_markdown = body.body_markdown
    await session.flush()
    return TemplateRead.model_validate(template)


@router.get("/{template_id}/preview", response_model=Preview)
async def preview_template(
    template_id: uuid.UUID,
    session: DbSession,
    speaker_id: uuid.UUID | None = None,
    _: User = Depends(require_role(*READ)),
) -> Preview:
    """The template against a real speaker on this event.

    Against a *real* one, not a made-up example: a merge field that resolves for
    "Test Person" and breaks on the speaker with no session is exactly the bug a
    preview exists to catch. With no id given it picks the first on the roster,
    so the control works before anyone has chosen anybody.
    """
    template = await session.get(MessageTemplate, template_id)
    if template is None:
        raise NotFoundError(f"No template with id {template_id}.")

    tenant = current_tenant()
    event = await session.get(Event, tenant.event_id)
    if event is None:
        raise NotFoundError("No event in scope.")

    statement = (
        select(Speaker)
        .join(EventSpeaker, EventSpeaker.speaker_id == Speaker.id)
        .order_by(Speaker.name)
        .limit(1)
    )
    if speaker_id is not None:
        statement = statement.where(Speaker.id == speaker_id)
    speaker = await session.scalar(statement)
    if speaker is None:
        raise NotFoundError("There is nobody on this event's roster to preview against.")

    values = await values_for(session, speaker=speaker, event=event)
    return Preview(
        speaker_name=speaker.name,
        subject=render(template.subject, values),
        body=render(template.body_markdown, values),
    )
