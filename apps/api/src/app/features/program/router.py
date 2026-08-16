"""Program setup: tracks, session formats, rooms, days.

Four identical resources, so they share the router factory in `core/crud.py`.
What each one *is* — its schemas, its hooks, the sentence its duplicate raises —
lives in `resources.py`, because the assistant reaches the same descriptions
without reaching a router (spec 0008).
"""

from __future__ import annotations

from app.core.crud import event_resource_router
from app.features.program.resources import SPECS

ROUTERS = [event_resource_router(spec) for spec in SPECS]
