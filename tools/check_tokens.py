#!/usr/bin/env python3
"""Every design token a screen references must actually be defined.

`var(--heroA, #FFF3F0)` is silently valid when `--heroA` does not exist — CSS
just takes the fallback. Since the fallbacks in the prototypes are all *light*
values, a missing or misspelled token is invisible until someone switches to
dark mode, where a hard-coded light hex sits on a dark page.

That is exactly how `--heroA` / `--heroB` / `--heroBd` / `--stepLn` shipped: the
token file spelled them lowercase, custom property names are case-sensitive, and
the portal's hero rendered a light-pink gradient across a dark screen.

Run from the repo root. Exits non-zero and names the offenders.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# A declaration can start a line, follow a `;` or `{`, or open a style="" —
# the prototypes put whole token maps on one line inside a <style> block.
DEFINITION = re.compile(r"""(?:^|[;{"'])\s*(--[A-Za-z0-9-]+)\s*:""", re.MULTILINE)
REFERENCE = re.compile(r"var\(\s*(--[A-Za-z0-9-]+)")

TOKEN_FILES = ("apps/web/src/styles/tokens.css", "apps/web/src/app/globals.css")
#: next/font declares these through `variable:` in the root layout and injects
#: them at runtime, so they never appear in a stylesheet. Read from there rather
#: than hard-coded, so renaming a font does not quietly disable this check.
FONT_SOURCE = "apps/web/src/app/layout.tsx"
FONT_VARIABLE = re.compile(r"variable:\s*[\"'](--[A-Za-z0-9-]+)[\"']")
SEARCH = (
    ("apps/web/src/components/design", "*.tsx"),
    ("apps/web/src/components/console", "*.tsx"),
    ("apps/web/src/app", "*.tsx"),
    ("GatherDesign", "*.dc.html"),
)


def main() -> int:
    root = Path(__file__).resolve().parent.parent

    defined: set[str] = set()
    for name in TOKEN_FILES:
        path = root / name
        if path.exists():
            defined |= set(DEFINITION.findall(path.read_text()))

    fonts = root / FONT_SOURCE
    if fonts.exists():
        defined |= set(FONT_VARIABLE.findall(fonts.read_text()))

    if not defined:
        print("check-tokens: no token file found, nothing to check")
        return 0

    used: dict[str, set[str]] = {}
    missing: dict[str, set[str]] = {}
    for folder, pattern in SEARCH:
        for path in (root / folder).rglob(pattern):
            text = path.read_text()
            where = str(path.relative_to(root))
            # A file may declare its own variables in a local <style> block —
            # the marketing prototype carries its own font stack that way. Those
            # count as defined for that file and nowhere else.
            local = defined | set(DEFINITION.findall(text))
            for token in REFERENCE.findall(text):
                used.setdefault(token, set()).add(where)
                if token not in local:
                    missing.setdefault(token, set()).add(where)

    problems = 0

    if missing:
        problems += len(missing)
        print(f"{len(missing)} token(s) referenced but never defined:", file=sys.stderr)
        for name, files in sorted(missing.items()):
            near = next((other for other in defined if other.lower() == name.lower()), None)
            # Case is the likely mistake, and the one that looks fine in light mode.
            hint = (
                f"  — defined as {near}; custom property names are case-sensitive" if near else ""
            )
            print(f"  {name}{hint}", file=sys.stderr)
            for where in sorted(files)[:3]:
                print(f"      {where}", file=sys.stderr)

    unthemed = _missing_from_dark(root)
    if unthemed:
        problems += len(unthemed)
        print(
            f"{len(unthemed)} colour token(s) defined for light but not dark:",
            file=sys.stderr,
        )
        for name in sorted(unthemed):
            print(f"  {name}", file=sys.stderr)
        print(
            "  A colour with no dark value keeps its light one, which is how a"
            " light gradient ends up on a dark page.",
            file=sys.stderr,
        )

    if problems:
        return 1
    print(f"check-tokens: {len(used)} referenced, all defined and themed")
    return 0


#: Tokens that are the same in every theme by nature. Everything else is a
#: colour, and a colour needs a dark value.
THEME_INDEPENDENT = ("--radius-", "--ease", "--dur-", "--track-", "--font-")

#: The accent set is owned by the theme provider, which writes a light and a dark
#: map onto the root element. Its keys are read from there rather than listed
#: here, so adding an accent variable does not silently escape this check.
ACCENT_SOURCE = "apps/web/src/lib/theme.ts"
ACCENT_DARK = re.compile(r"\bd:\s*\{([^}]*)\}")
ACCENT_KEY = re.compile(r"\b([a-z][a-z0-9]*)\s*:")


def _provider_owned(root: Path) -> set[str]:
    """Tokens the theme provider sets for dark mode at runtime."""
    path = root / ACCENT_SOURCE
    if not path.exists():
        return set()
    keys: set[str] = set()
    for block in ACCENT_DARK.findall(path.read_text()):
        keys |= {f"--{key}" for key in ACCENT_KEY.findall(block)}
    return keys


def _missing_from_dark(root: Path) -> set[str]:
    """Colour tokens the light block defines and the dark block forgets."""
    path = root / TOKEN_FILES[0]
    if not path.exists():
        return set()
    text = path.read_text()

    dark_at = text.find('[data-theme="dark"]')
    if dark_at == -1:
        return set()

    light = set(DEFINITION.findall(text[:dark_at]))
    dark = set(DEFINITION.findall(text[dark_at:])) | _provider_owned(root)
    return {
        name
        for name in light - dark
        if not any(name.startswith(prefix) for prefix in THEME_INDEPENDENT)
    }


if __name__ == "__main__":
    raise SystemExit(main())
