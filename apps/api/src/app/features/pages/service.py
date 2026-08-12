"""Portal resource pages, and the sanitiser that makes them safe to render.

An organiser pastes HTML they got from somewhere else — a Google Doc embed, a
YouTube walkthrough, a run-of-show table — and every speaker on the event then
renders it. That is untrusted input on a stored-XSS path, so it is cleaned once
on write against an allowlist and never on render: a page that reached the
database dirty would be re-cleaned by every reader, or by none.
"""

from __future__ import annotations

import re

import nh3

#: Formatting an organiser would reasonably paste, plus `iframe` because
#: "HTML embed support for existing reference material" is the point of the
#: feature. Everything not named here is unwrapped, not escaped, so a stray
#: `<div>` leaves its text behind rather than showing markup to a speaker.
ALLOWED_TAGS = {
    "p", "br", "hr", "strong", "b", "em", "i", "u", "s", "code", "pre", "blockquote",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "dl", "dt", "dd",
    "table", "thead", "tbody", "tr", "th", "td", "caption",
    "a", "img", "figure", "figcaption", "span", "iframe",
}  # fmt: skip

#: No `style`, and no event handlers anywhere — `on*` attributes are the whole
#: reason this function exists. `iframe` gets the minimum a real embed needs.
ALLOWED_ATTRIBUTES = {
    # No "rel": `link_rel` below owns it, and nh3 refuses to have both.
    "a": {"href", "title", "target"},
    "img": {"src", "alt", "title", "width", "height", "loading"},
    "iframe": {"src", "title", "width", "height", "allowfullscreen", "loading"},
    "th": {"colspan", "rowspan", "scope"},
    "td": {"colspan", "rowspan"},
}

#: `javascript:` is the obvious one; `data:` is the one people forget, because
#: a `data:text/html` document runs with the page's own origin.
ALLOWED_SCHEMES = {"https", "mailto"}


def sanitize_html(raw: str) -> str:
    """Clean one embed block against the allowlist above.

    `link_rel` forces `noopener` on every anchor: an embed is somebody else's
    markup, and `target="_blank"` without it hands the opener to whatever it
    links to.
    """
    return nh3.clean(
        raw,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        url_schemes=ALLOWED_SCHEMES,
        link_rel="noopener noreferrer",
    )


_SLUG_STRIP = re.compile(r"[^a-z0-9]+")


def slugify(title: str) -> str:
    """A URL-safe slug, or `page` when a title has nothing to make one from —
    a page titled entirely in a non-Latin script must still save."""
    slug = _SLUG_STRIP.sub("-", title.lower()).strip("-")[:200]
    return slug or "page"
