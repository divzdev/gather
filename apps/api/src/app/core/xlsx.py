"""Spreadsheet responses.

Three exports now build a workbook the same way — review results, the programme,
and submissions — and the identical part is all of it except the rows. Excel is
what programme committees actually pass around, so the file has to be right:
frozen header, readable column widths, numbers stored as numbers so a score
column sorts 9 before 10.
"""

from __future__ import annotations

import io
from collections.abc import Iterable, Sequence
from typing import Any

from fastapi import Response

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

_COLUMN_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def spreadsheet(
    *,
    title: str,
    filename: str,
    header: Sequence[str],
    rows: Iterable[Sequence[Any]],
    widths: Sequence[int],
) -> Response:
    """One sheet, as a download."""
    from openpyxl import Workbook

    book = Workbook()
    sheet = book.active
    if sheet is None:  # pragma: no cover - a new Workbook always has one
        raise RuntimeError("openpyxl returned a workbook with no active sheet.")

    sheet.title = title
    sheet.append(list(header))
    for row in rows:
        sheet.append(list(row))

    sheet.freeze_panes = "A2"
    for letter, width in zip(_COLUMN_LETTERS, widths, strict=False):
        sheet.column_dimensions[letter].width = width

    buffer = io.BytesIO()
    book.save(buffer)
    return Response(
        content=buffer.getvalue(),
        media_type=XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
