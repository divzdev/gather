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
  core/        config, db, tenancy, auth deps, errors, pagination
  models/      SQLAlchemy 2.0, the shared schema spine
  features/    one folder per capability: router · service · schemas
apps/web     Next.js App Router. Design tokens in src/styles/tokens.css.
apps/embed   Standalone widget bundle for embedding the schedule elsewhere.
```

## Reading the code

Four things explain most of the design:

- **Tenancy is automatic.** `org_id`/`event_id` filtering is applied by SQLAlchemy session
  events, not at call sites, so no query can forget it. A query with no tenant in context
  **raises** rather than returning everything, and bulk `UPDATE`/`DELETE` without a tenant
  predicate is rejected. See `apps/api/src/app/core/tenancy.py`.
- **Deciding is not sending.** Recording an accept/reject writes a pending state and emails
  nobody. One endpoint sends, and it re-verifies the recipient count server-side first — so a
  stale browser tab cannot mass-mail the wrong decisions.
- **The public schedule reads a snapshot.** Publishing writes an immutable versioned JSON
  document; public pages never join live tables. Rollback is republishing an older version.
- **One form engine.** The same JSON schema and conditional-logic evaluator drives the CFP form
  and the speaker portal's task forms. It runs in the browser for feedback and on the server for
  truth, bound by a shared fixture file so the two cannot drift.

Times are stored UTC as `timestamptz`; the client renders using the event's timezone.
Migrations are forward-only and CI proves each one reverses cleanly.

## Licence

MIT — see [LICENSE](LICENSE).
