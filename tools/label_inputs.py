"""Give every prototype input a programmatic label.

The design draws field labels as styled `<div>`s sitting above the input. They
look right and mean nothing: no `for`, no `id`, so a screen reader announces an
unlabelled edit box and `getByLabel` finds nothing. The build manifest asks for
"real `<label for>` on each", and this makes that true without touching how any
of it looks — a `<label>` carrying the same inline style renders identically.

Idempotent: a file that already has its labels wired is left alone. Run it after
editing a prototype, then re-run `dc2tsx.py`.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

# `<div style="...">Some Label</div>` immediately followed by an input/textarea/select.
PAIR = re.compile(
    r'<div (?P<style>style="[^"]*")>(?P<text>[^<>{}]{2,60})</div>\s*'
    r"(?P<tag><(?:input|textarea|select)\b)",
    re.IGNORECASE,
)
PLACEHOLDER = re.compile(r'placeholder="([^"{}]+)"')


def slugify(text: str, used: set[str]) -> str:
    stem = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "field"
    candidate = stem
    suffix = 2
    while candidate in used:
        candidate = f"{stem}-{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def wire(source: str, prefix: str) -> tuple[str, int]:
    used: set[str] = set(re.findall(r'id="([^"]+)"', source))
    wired = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal wired
        text = match.group("text").strip()
        # Skip anything that is plainly not a label: numbers, punctuation runs.
        if not re.search(r"[A-Za-z]{2}", text):
            return match.group(0)
        ident = f"{prefix}-{slugify(text, used)}"
        wired += 1
        return (
            f'<label for="{ident}" {match.group("style")}>{text}</label>'
            f'{match.group("tag")} id="{ident}"'
        )

    out = PAIR.sub(replace, source)

    # Anything still unlabelled falls back to its placeholder, which is better
    # than nothing and is what the field already shows the sighted user.
    def aria(match: re.Match[str]) -> str:
        chunk = match.group(0)
        if 'id="' in chunk or "aria-label" in chunk:
            return chunk
        found = PLACEHOLDER.search(chunk)
        if found is None:
            return chunk
        return chunk.replace("<input", f'<input aria-label="{found.group(1)}"', 1)

    out = re.sub(r"<input\b[^>]*>", aria, out)
    return out, wired


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "GatherDesign"
    targets = sorted(
        path
        for path in root.glob("*.dc.html")
        # Retired copies are kept for reference and are not generated from.
        if " v1" not in path.name
    )
    total = 0
    for path in targets:
        source = path.read_text(encoding="utf-8")
        prefix = re.sub(r"[^a-z0-9]+", "-", path.stem.lower().replace(".dc", "")).strip("-")
        out, wired = wire(source, prefix)
        if out != source:
            path.write_text(out, encoding="utf-8")
            print(f"{path.name}: wired {wired} label(s)")
            total += wired
    print(f"total: {total}")
    if total == 0:
        print("nothing to do")
        sys.exit(0)


if __name__ == "__main__":
    main()
