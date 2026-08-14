#!/usr/bin/env python3
"""Every text-bearing token pair must hold WCAG AA, in both theme maps.

The palette restyle (docs/specs/0002) fixes colour values in tokens.css alone —
no runtime accent writes — so this file is the one place a contrast regression
can enter. The pairs asserted here are the ones that carry real text:

  · ink tiers (--ik --i2 --i3 --i4) on every neutral surface they land on
    (--pp page, --cd card, --sk sunk)
  · each status colour as text on its own weak tint, which is the darkest
    surface it meets: conflict, pending, ok, accent/in-flight, info
  · the primary button foreground on the button fill

Run from the repo root. Exits non-zero and names each failing pair with the
measured ratio, per map.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

TOKENS = Path("apps/web/src/styles/tokens.css")
FLOOR = 4.5

TEXT_TIERS = ("ik", "i2", "i3", "i4")
SURFACES = ("pp", "cd", "sk")
STATUS_PAIRS = (
    ("cn", "cnw"),
    ("pd", "pdw"),
    ("ok", "okw"),
    ("sg", "sw"),
    ("if", "ifw"),
    ("bf", "bt"),
)

HEX_TOKEN = re.compile(r"--([a-zA-Z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b")


def luminance(hex_color: str) -> float:
    channels = [int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]


def contrast(a: str, b: str) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def parse_maps(css: str) -> dict[str, dict[str, str]]:
    """First :root block is the light map; the data-theme block is dark.

    Markers are anchored to line starts — the prose comments above the light
    map also contain ":root," and must not win. Neither map nests braces, so
    slicing to the first "}" holds; a marker that vanishes is a hard error
    naming the file, not a silent empty map.
    """
    maps: dict[str, dict[str, str]] = {}
    for name, marker in (("light", r"^:root,"), ("dark", r'^:root\[data-theme="dark"\]')):
        match = re.search(marker, css, re.MULTILINE)
        if match is None:
            raise SystemExit(f"contrast: {TOKENS} has no line matching {marker!r} — cannot find the {name} map")
        block = css[match.start() : css.index("}", match.start())]
        maps[name] = {m.group(1): m.group(2) for m in HEX_TOKEN.finditer(block)}
    return maps


def main() -> int:
    css = TOKENS.read_text(encoding="utf-8")
    failures: list[str] = []

    for theme, tokens in parse_maps(css).items():
        pairs = [(t, s) for t in TEXT_TIERS for s in SURFACES] + list(STATUS_PAIRS)
        for fg, bg in pairs:
            if fg not in tokens or bg not in tokens:
                failures.append(f"{theme}: --{fg} or --{bg} missing from map")
                continue
            ratio = contrast(tokens[fg], tokens[bg])
            if ratio < FLOOR:
                failures.append(
                    f"{theme}: --{fg} {tokens[fg]} on --{bg} {tokens[bg]} = {ratio:.2f} (< {FLOOR})"
                )

    if failures:
        print("contrast: FAIL")
        for line in failures:
            print(f"  {line}")
        return 1
    print("contrast: ok (both maps, all text pairs ≥ 4.5)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
