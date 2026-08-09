"""Print the OpenAPI schema to stdout. Consumed by `make types`.

Runs without a database or a running server: FastAPI builds the schema from the
route signatures alone.
"""

from __future__ import annotations

import json

from app.main import app


def main() -> None:
    print(json.dumps(app.openapi(), indent=2))


if __name__ == "__main__":
    main()
