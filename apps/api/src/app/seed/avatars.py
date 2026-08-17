"""Deterministic identicons for seeded speakers.

The gallery is a grid of faces, and the demo had none: every seeded speaker
published with `headshot_file_id` null, so the widget an organiser is most
likely to show off rendered as a wall of grey placeholders. A judge cannot tell
that from a missing feature.

These are identicons, not photographs, and deliberately so. Inventing realistic
faces for people who do not exist would make the demo lie about its own data;
symmetric geometry is honestly synthetic, reads well at card size, and is stable
per person because it is derived from a hash of the name.

Written as raw PNG bytes rather than through an imaging library: Pillow is not a
dependency of this service and adding one so the seed can draw squares is a poor
trade.
"""

from __future__ import annotations

import binascii
import hashlib
import struct
import zlib

#: 5 wide so the middle column is its own mirror line, 240px so a retina card at
#: 120 has real pixels to use.
GRID = 5
CELL = 48
SIZE = GRID * CELL

#: Muted and deliberately unsaturated — a gallery of forty of these sits behind
#: names and job titles, and it must not shout over them.
INKS: tuple[tuple[int, int, int], ...] = (
    (94, 110, 141),
    (122, 106, 138),
    (86, 125, 120),
    (140, 108, 96),
    (104, 118, 96),
    (128, 100, 112),
    (96, 112, 132),
    (118, 122, 98),
)
PAPER = (238, 240, 243)


def _chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    )


def _png(pixels: list[list[tuple[int, int, int]]]) -> bytes:
    """Encode RGB rows as a PNG. Filter byte 0 on every scanline — these are
    flat blocks, so predictors would buy nothing but complexity."""
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("BBB", *pixel) for pixel in row) for row in pixels
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )


def identicon(seed: str) -> bytes:
    """A stable, mirror-symmetric identicon for `seed`.

    Symmetric because asymmetric noise reads as a corrupted image rather than a
    designed one, and a speaker's avatar is next to their name on a public page.
    """
    digest = hashlib.sha256(seed.strip().lower().encode()).digest()
    ink = INKS[digest[0] % len(INKS)]

    # Left half plus the centre column; the rest is a mirror.
    half = GRID // 2 + 1
    filled = [
        [bool(digest[1 + column * GRID + row] & 1) for column in range(half)] for row in range(GRID)
    ]

    pixels: list[list[tuple[int, int, int]]] = []
    for y in range(SIZE):
        row_cells = filled[y // CELL]
        row: list[tuple[int, int, int]] = []
        for x in range(SIZE):
            column = x // CELL
            mirrored = column if column < half else GRID - 1 - column
            row.append(ink if row_cells[mirrored] else PAPER)
        pixels.append(row)
    return _png(pixels)
