"""Calendar entries for a published session.

Two properties do the real work. **UID is stable** — derived from the session id,
never regenerated — so a speaker's calendar updates the existing entry instead of
growing a second one every time the schedule moves. **SEQUENCE increments** with
the published version, because a client is entitled to ignore an update that does
not claim to be newer than what it already has.

Hand-rolled rather than pulled in: RFC 5545 for a single VEVENT is a few lines of
escaping and folding, and the alternative is a dependency for one function.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any

LINE_LIMIT = 75
NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def _escape(value: str) -> str:
    """Backslash first, or it would double-escape everything added after it."""
    out = value.replace("\\", "\\\\")
    for char, replacement in ((";", r"\;"), (",", r"\,"), ("\n", r"\n")):
        out = out.replace(char, replacement)
    return out


def _fold(line: str) -> str:
    """RFC 5545 caps a content line at 75 octets; continuations start with a space."""
    if len(line) <= LINE_LIMIT:
        return line
    head, rest = line[:LINE_LIMIT], line[LINE_LIMIT:]
    chunks = [rest[index : index + LINE_LIMIT - 1] for index in range(0, len(rest), LINE_LIMIT - 1)]
    return "\r\n ".join([head, *chunks])


def _stamp(moment: datetime) -> str:
    return moment.strftime("%Y%m%dT%H%M%SZ")


def uid_for(session_id: str) -> str:
    """Stable across every republish, so calendars update rather than duplicate."""
    return f"{uuid.uuid5(NAMESPACE, session_id)}@gather"


def build(talk: dict[str, Any], *, event: dict[str, Any], sequence: int, now: datetime) -> str:
    """One VEVENT for one session. Returns an empty string if it has no time yet."""
    if not talk.get("starts_at"):
        return ""

    starts = datetime.fromisoformat(str(talk["starts_at"]).replace("Z", "+00:00"))
    ends = starts + timedelta(minutes=int(talk.get("duration_minutes") or 30))
    speakers = ", ".join(person["name"] for person in talk.get("speakers", []))
    location = " · ".join(part for part in [talk.get("room"), event.get("location")] if part)

    description = talk.get("abstract") or ""
    if speakers:
        description = f"{speakers}\n\n{description}".strip()

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Gather//Conference Schedule//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:{uid_for(str(talk['id']))}",
        f"SEQUENCE:{sequence}",
        f"DTSTAMP:{_stamp(now)}",
        f"DTSTART:{_stamp(starts)}",
        f"DTEND:{_stamp(ends)}",
        _fold(f"SUMMARY:{_escape(str(talk.get('title') or 'Session'))}"),
        _fold(f"DESCRIPTION:{_escape(description)}"),
        _fold(f"LOCATION:{_escape(location)}"),
        "STATUS:CONFIRMED",
        "END:VEVENT",
        "END:VCALENDAR",
    ]
    return "\r\n".join(lines) + "\r\n"


def calendar_links(talk: dict[str, Any], *, event: dict[str, Any]) -> dict[str, str]:
    """Google and Outlook take the whole event in a URL.

    The brief names all three targets, and only iCal is served as a file; these
    two are links, so an organiser's email can offer every option.
    """
    if not talk.get("starts_at"):
        return {}

    starts = datetime.fromisoformat(str(talk["starts_at"]).replace("Z", "+00:00"))
    ends = starts + timedelta(minutes=int(talk.get("duration_minutes") or 30))
    from urllib.parse import quote

    title = quote(str(talk.get("title") or "Session"))
    where = quote(" · ".join(part for part in [talk.get("room"), event.get("location")] if part))
    return {
        "google": (
            "https://calendar.google.com/calendar/render?action=TEMPLATE"
            f"&text={title}&dates={_stamp(starts)}/{_stamp(ends)}&location={where}"
        ),
        "outlook": (
            "https://outlook.live.com/calendar/0/deeplink/compose?path=/calendar/action/compose"
            f"&subject={title}&startdt={starts.isoformat()}&enddt={ends.isoformat()}"
            f"&location={where}"
        ),
    }
