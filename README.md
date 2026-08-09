# Gather

Open-source speaker and session management for conferences — an alternative to
Sessionboard. CFP intake, review and scoring, accept/reject, speaker onboarding,
drag-and-drop agenda building with conflict detection, and a published public
schedule.

## Run it

Requires Docker, [uv](https://docs.astral.sh/uv/), and Node 20+.

```bash
make setup   # deps, .env, Postgres + Redis, migrations, demo data
make dev     # api + worker + web
```

**No credentials are needed.** Mail is written to `.mail/` as HTML, uploads go to
the local filesystem, and the AI features fall back to a stub adapter — the app is
fully usable without a single API key. That is enforced by tests, not convention.

| | |
|---|---|
| Web | http://127.0.0.1:3000 |
| API | http://127.0.0.1:8051/v1 |
| API docs | http://127.0.0.1:8051/v1/docs |
| Postgres | `localhost:5441` (`gather` / `gather`) |
| Redis | `localhost:6379` |

## Commands

```bash
make test     # pytest + Playwright
make lint     # ruff, mypy, tsc, eslint
make db.reset # drop, migrate, reseed
make types    # regenerate the frontend's API types from the OpenAPI schema
```

## Layout

```
apps/api     FastAPI, async end to end. router → service → models.
apps/web     Next.js App Router.
apps/embed   Standalone widget bundle for embedding the schedule elsewhere.
docs/        Architecture, domain context, delivery plan, decisions.
```

## Reading the code

Start with [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — the system shape, how
multi-tenancy is enforced, and every significant decision with the alternative
that was rejected. [`docs/APP_CONTEXT.md`](docs/APP_CONTEXT.md) covers the domain:
what the nouns mean and which invariants must hold.

Two things are worth knowing before you change anything:

- **Deciding is not sending.** Recording an accept/reject writes a pending state
  and emails nobody. Only one endpoint sends, and it re-verifies the recipient
  count server-side first.
- **Tenancy is automatic.** `org_id`/`event_id` filtering is applied by SQLAlchemy
  session events, not at call sites. Queries with no tenant in context raise
  rather than returning everything.

## Licence

MIT — see [LICENSE](LICENSE).
