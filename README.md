# Gather

**Open-source speaker and session management for conferences.** The operations layer for running
a speaker programme: call for papers, blind review and scoring, accept/reject, chasing speakers
for bios and slides, drag-and-drop agenda building with live conflict detection, and a published
public schedule.

It is an alternative to [Sessionboard](https://www.sessionboard.com/), which costs roughly
$40k/year. Registration, ticketing and check-in are deliberately **not** here — that is a
different product, and it already exists.

```bash
make setup && make dev     # a running, seeded conference. no API keys, no accounts.
```

---

## What it actually does

Four people use this, and they see four different products.

**The organiser** opens a call for papers built from a form they designed themselves, watches
proposals arrive, assigns reviewers, sets decisions in bulk, and then — separately, deliberately —
sends them. They drag sessions onto a room × time grid that flags double-bookings as the card
moves, and publish a schedule the public can read.

**The reviewer** gets a reduced console containing only the proposals assigned to them, scored
against a rubric the organiser defined. If the round is blind, the API strips speaker identity and
every answer flagged as identity-bearing before the response leaves the server — not the UI, the
API, so a reviewer cannot un-blind a round by opening devtools.

**The speaker** never gets a password. Their email is their identity, a magic link is their key,
and the portal is one phone-shaped page: your session, your deadlines, upload your headshot.

Staff sign in with a password, a link to their own inbox, or GitHub. The emailed link does two jobs
— it is the password recovery this build deliberately has instead of a reset, and clicking it is how
an address gets confirmed. Until it is, an account can do everything except the things that reach
somebody else: sending decisions, sending mail, publishing a schedule. GitHub is optional and off
unless you configure it; with no client id the button is not drawn and the routes do not exist.

**The public** reads a schedule, browses speakers, and builds a personal itinerary that survives a
reload — or an organiser embeds any of it in an existing conference site with one `<script>` tag.

---

## Run it

Requires Docker, [uv](https://docs.astral.sh/uv/), and Node 20+. Python 3.12 is installed by `uv`.

```bash
make setup   # dependencies, .env, Postgres + Redis, migrations, demo data
make dev     # api + worker + web
```

Open **http://127.0.0.1:3000** and use the demo buttons in the top bar — Organizer, Reviewer,
Speaker — to enter as any of them. No sign-up.

**No credentials are required, for anything.** Mail renders to `.mail/` as HTML instead of
sending. Uploads go to the local filesystem. The AI adapter falls back to a deterministic stub.
This is enforced by a test, not by convention: if a code path ever needs a key to work locally,
the suite fails.

The seed is a realistic conference, not three rows — **214 submissions, 80 speakers, 61 sessions**
across 3 days and 4 rooms, with deliberate scheduling conflicts, half-finished speaker
deliverables and a queue of decisions waiting to be sent. Empty software teaches you nothing
about whether it works.

|                      |                                        |
| -------------------- | -------------------------------------- |
| Web                  | http://127.0.0.1:3000                  |
| API                  | http://127.0.0.1:8051/v1               |
| Interactive API docs | http://127.0.0.1:8051/v1/docs          |
| Postgres             | `localhost:5441` — `gather` / `gather` |
| Redis                | `localhost:6379`                       |

---

## The decisions that explain the code

Five choices account for most of what looks unusual in here.

**Deciding is not sending.** Recording accept/reject/waitlist writes a pending state and emails
nobody. Exactly one endpoint sends, and it requires a recipient count that the server recomputes
and compares — a stale browser tab cannot mass-mail 200 speakers the wrong outcome. This is the
most important rule in the product and everything else bends around it.

**Tenancy is automatic, and failure is loud.** `org_id`/`event_id` filtering is applied by
SQLAlchemy session events from a context variable, never by hand at call sites, so no query can
forget it. A query with no tenant in context **raises** rather than quietly returning everything,
and a bulk `UPDATE`/`DELETE` without a tenant predicate is rejected outright. Escaping the filter
requires a named, greppable context manager. → `apps/api/src/app/core/tenancy.py`

**A conflicting placement is always accepted.** Drag-and-drop never rejects a drop. The API
persists it and returns the conflicts it created; the UI surfaces them as ribbons you can resolve,
swap or knowingly ignore. Organisers overlap tracks on purpose, and software that refuses the
thing you meant is worse than software that tells you what you just did.

**The public schedule reads a snapshot.** Publishing writes an immutable, versioned JSON document.
Public pages and the embed read only that — never live tables — so an organiser editing tomorrow's
agenda cannot change what today's attendees are looking at. Rollback is republishing an earlier
version.

**One form engine.** The same JSON schema and conditional-logic evaluator drives both the CFP form
and the speaker portal's task forms. It runs in the browser for immediate feedback and on the
server for truth, bound to a shared fixture so the two cannot drift. Forms lock structurally once
the first submission arrives: fields stay addable, but deleting one becomes "hide from new
submissions" so existing answers survive.

Times are stored as UTC `timestamptz` and rendered in the event's timezone. Migrations are
forward-only, and CI proves each one applies and round-trips.

---

## Layout

```
apps/api      FastAPI, async end to end.  router → service → models
  core/         config · db · tenancy · deps · errors · idempotency · pagination
  models/       SQLAlchemy 2.0 typed — the shared schema spine, central on purpose
  features/     one folder per capability: router · service · schemas
  jobs/         worker: reminders, scheduled mail, the nightly overdue sweep
  seed/         idempotent demo data
apps/web      Next.js App Router — public event site · admin console · speaker portal
GatherDesign  the HTML prototypes the components in src/components/design are generated from
tools/        that generator (dc2tsx.py, with a guard against overwriting hand edits),
              the design-token budget check, and the prototype label wiring
```

There is no `repositories/` layer. Tenancy is enforced at the session, so a repository would only
forward calls — the abstraction would cost a file per model and buy nothing.

---

## Commands

```bash
make test       # 341 API tests + 169 end-to-end tests
make test.api   # pytest only
make test.e2e   # Playwright, against an isolated database it creates and drops
make lint       # ruff · mypy · tsc · eslint · design-token check
make db.reset   # drop, migrate, reseed
make types      # regenerate the frontend's API types from the OpenAPI schema
```

`make test.e2e` builds its own Postgres database and its own API and web servers on separate
ports, then tears all of it down. Browser tests never touch your development data.

`make types` is not optional politeness: the frontend's API types are generated from the OpenAPI
schema, and hand-writing a type that describes a response is how a client starts lying about the
server.

---

## Not built

Named here because a feature list that only lists wins is a sales page, not a README.

- **AI, entirely.** No gateway, no model call. The agenda's scheduling assistant is a
  deterministic first-fit packer. Where the design anticipated AI, the rule it would follow is
  already written down: AI proposes, a human accepts, and accepting calls the same service method
  the UI does.
- **Accelevents push** — designed, not implemented.
- **Saved views** and **custom submission statuses.**

Explicit non-goals, which will not be built: registration, ticketing, attendee records, badging,
sponsors, travel, billing, SSO, SMS, webhooks, internationalisation, or an analytics dashboard.

---

## Licence

MIT — see [LICENSE](LICENSE).
