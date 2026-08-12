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
# the prototypes put whole token maps on one line inside a <style> block. The
# optional closing quote is for converted screens, where the same map arrives
# as a React style object: `"--bg": "#08080A"`.
DEFINITION = re.compile(r"""(?:^|[;{"'])\s*(--[A-Za-z0-9-]+)["']?\s*:""", re.MULTILINE)
REFERENCE = re.compile(r"var\(\s*(--[A-Za-z0-9-]+)")

#: tokens.css is the console's themed palette and the first entry is special —
#: `_missing_from_dark` reads it alone, because it is the only one with a light
#: and a dark map. marketing.css is the landing page's own palette, a single
#: fixed dark treatment scoped to `[data-marketing]`; its `--indigo`/`--teal`/
#: `--rose`/`--sage`/`--sky` are the per-section hues the design calls for and
#: they have no light counterpart by design, so they belong here rather than in
#: the themed file.
TOKEN_FILES = (
    "apps/web/src/styles/tokens.css",
    "apps/web/src/app/globals.css",
    "apps/web/src/styles/marketing.css",
    "apps/web/src/styles/event.css",
)
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

    raw, worst = _raw_hex(root)
    if raw > RAW_HEX_BUDGET:
        problems += 1
        print(
            f"{raw} raw hex colours in components, over the budget of {RAW_HEX_BUDGET}."
            " A literal colour cannot follow the theme or the chosen accent:",
            file=sys.stderr,
        )
        for where, count in worst[:8]:
            print(f"  {count:4d}  {where}", file=sys.stderr)
        print(
            "  Use var(--token) — or var(--token, #fallback), which is allowed and"
            " is what the converted prototypes carry.",
            file=sys.stderr,
        )
    elif raw < RAW_HEX_BUDGET:
        print(
            f"check-tokens: raw hex down to {raw} (budget {RAW_HEX_BUDGET})."
            f" Lower RAW_HEX_BUDGET to {raw} so it cannot climb back.",
        )

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
THEME_INDEPENDENT = (
    "--radius-",
    "--ease",
    "--dur-",
    "--track-",
    "--font-",
    "--space-",
    "--control-h-",
)

# --- raw hex ---------------------------------------------------------------
#
# The check above proves that `var(--x)` resolves. It says nothing about a
# literal `#E04E4E` sitting where a token belongs — which is the bigger defect,
# because it silently ignores both the theme and the swappable accent. That is
# how 58 focus rings stayed light-mode coral in dark mode.
#
# It cannot simply fail: the four public marketing screens are painted in fixed
# light hexes on purpose, and the converted prototypes are full of them. So it
# is a ratchet — the count may fall and never rise. Drop the number whenever it
# does; the message tells you to.
RAW_HEX_BUDGET = 111

HEX = re.compile(r"#[0-9A-Fa-f]{3,8}\b")
#: `var(--token, #fallback)` is the documented pattern, not a violation.
VAR_FALLBACK = re.compile(r"var\(\s*--[A-Za-z0-9-]+\s*,\s*#[0-9A-Fa-f]{3,8}\s*\)")
#: Brand artwork. The Gather mark is a fixed set of colours, not theme state.
SVG_BLOCK = re.compile(r"<svg\b.*?</svg>", re.DOTALL)


def _raw_hex(root: Path) -> tuple[int, list[tuple[str, int]]]:
    """Hex literals that are neither a var() fallback nor inside an <svg>."""
    counts: dict[str, int] = {}
    for folder, pattern in SEARCH:
        base = root / folder
        if not base.exists() or folder.startswith("GatherDesign"):
            continue
        for path in base.rglob(pattern):
            text = SVG_BLOCK.sub("", path.read_text())
            text = VAR_FALLBACK.sub("", text)
            found = len(HEX.findall(text))
            if found:
                counts[str(path.relative_to(root))] = found
    worst = sorted(counts.items(), key=lambda item: -item[1])
    return sum(counts.values()), worst

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


#: A declaration with its value, so the check can ask what a token *is* rather
#: than guess from its name.
DECLARATION = re.compile(r"(--[A-Za-z0-9-]+)\s*:\s*([^;}]+)")
COLOUR_VALUE = re.compile(r"#[0-9A-Fa-f]{3,8}\b|\b(?:rgba?|hsla?|color-mix|oklch|lab)\(")


def _missing_from_dark(root: Path) -> set[str]:
    """Colour tokens the light block defines and the dark block forgets.

    Whether a token needs a dark value is decided by its **value**, not its
    name: `--space-1: 4px` is 4px in both themes and a dark duplicate would be
    noise that rots. Keying off a name prefix meant every new non-colour scale
    had to be remembered here, and the first two — spacing and control heights —
    duly failed the gate the day they were added.
    """
    path = root / TOKEN_FILES[0]
    if not path.exists():
        return set()
    text = path.read_text()

    dark_at = text.find('[data-theme="dark"]')
    if dark_at == -1:
        return set()

    light_block = text[:dark_at]
    light = set(DEFINITION.findall(light_block))
    dark = set(DEFINITION.findall(text[dark_at:])) | _provider_owned(root)

    colours = {
        name
        for name, value in DECLARATION.findall(light_block)
        if COLOUR_VALUE.search(value)
    }
    return {
        name
        for name in (light & colours) - dark
        if not any(name.startswith(prefix) for prefix in THEME_INDEPENDENT)
    }


if __name__ == "__main__":
    raise SystemExit(main())
