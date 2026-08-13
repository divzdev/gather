# Gather

**Run your conference's speaker programme without the $40k invoice.**

Call for papers → blind review → decisions → chasing speakers for bios and slides → drag-and-drop
agenda with live conflict detection → a published public schedule.

An open-source alternative to [Sessionboard](https://www.sessionboard.com/). Registration,
ticketing and check-in are deliberately **not** here — that is a different product, and it already
exists.

```bash
make setup && make dev     # a running, seeded conference. no API keys, no accounts.
```

<!-- VIDEO: replace the src below with a GitHub attachment URL.
     Drag gather-sizzle.mp4 into any GitHub issue comment (do not submit it), copy the
     https://github.com/user-attachments/assets/... URL it generates, and paste it here.
     Do not commit the .mp4 — git history is permanent and a 6MB file rides in every clone.

<video src="PASTE_URL_HERE" controls width="100%"></video>

-->

---

## Try it in 60 seconds

**You need:** Docker · [uv](https://docs.astral.sh/uv/) · Node 20+ &nbsp;(Python 3.12 comes from `uv`)

```bash
git clone <this repo> && cd gather
make setup   # deps, .env, Postgres + Redis, migrations, demo data
make dev     # api + worker + web
```

Open **http://127.0.0.1:3000** and hit a demo button in the top bar — **Organizer**, **Reviewer**
or **Speaker**. No sign-up, no config.

|             |                                        |
| ----------- | -------------------------------------- |
| 🖥️ Web      | http://127.0.0.1:3000                  |
| ⚙️ API      | http://127.0.0.1:8051/v1               |
| 📖 API docs | http://127.0.0.1:8051/v1/docs          |
| 🐘 Postgres | `localhost:5441` · `gather` / `gather` |
| 🔴 Redis    | `localhost:6379`                       |

**Zero credentials, for anything.** Mail renders to `.mail/` as HTML instead of sending. Uploads go
to disk. The AI adapter falls back to a deterministic stub. A test enforces this — if a code path
ever needs a key to work locally, the suite fails.

The seed is a real conference, not three rows: **214 submissions · 80 speakers · 61 sessions** over
3 days and 4 rooms, with deliberate scheduling clashes, half-finished speaker deliverables and a
queue of decisions waiting to be sent. Empty software teaches you nothing.

---

## Four people, four products

| Who           | What they see                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Organiser** | Builds the CFP form, watches proposals land, assigns reviewers, sets decisions in bulk — then _separately_ sends them. Drags sessions onto a room × time grid that flags double-bookings mid-drag. |
| **Reviewer**  | A reduced console with only their assigned proposals, scored against the organiser's rubric. Keyboard-driven end to end.                                                                           |
| **Speaker**   | No password, ever. Email is identity, a magic link is the key, and the portal is one phone-shaped page: your session, your deadlines, upload your headshot.                                        |
| **Public**    | Reads the schedule, browses speakers, builds an itinerary that survives a reload — or the organiser drops any of it into an existing site with one `<script>` tag.                                 |

Blind review is enforced **at the API**, not the UI: speaker identity and every answer flagged
identity-bearing are stripped before the response leaves the server. A reviewer cannot un-blind a
round by opening devtools.

---

## Five decisions that explain the code

<details open>
<summary><b>Deciding is not sending</b> — the most important rule in the product</summary>

Recording accept/reject/waitlist writes a pending state and emails nobody. Exactly one endpoint
sends, and it demands a recipient count the server recomputes and compares. A stale browser tab
cannot mass-mail 200 speakers the wrong outcome. Everything else bends around this.
</details>

<details>
<summary><b>Tenancy is automatic, and failure is loud</b></summary>

`org_id`/`event_id` filtering is applied by SQLAlchemy session events from a context variable,
never by hand at call sites — so no query can forget it. A query with no tenant in context
**raises** rather than quietly returning everything, and a bulk `UPDATE`/`DELETE` without a tenant
predicate is rejected outright. Escaping requires a named, greppable context manager.
→ `apps/api/src/app/core/tenancy.py`
</details>

<details>
<summary><b>A conflicting placement is always accepted</b></summary>

Drag-and-drop never rejects a drop. The API persists it and returns the conflicts it created; the
UI surfaces them as ribbons you can resolve, swap, or knowingly ignore. Organisers overlap tracks
on purpose, and software that refuses what you meant is worse than software that tells you what
you just did.
</details>

<details>
<summary><b>The public schedule reads a snapshot</b></summary>

Publishing writes an immutable, versioned JSON document. Public pages and the embed read only that
— never live tables — so an organiser editing tomorrow's agenda cannot change what today's
attendees are looking at. Rollback is republishing an earlier version.
</details>

<details>
<summary><b>One form engine</b></summary>

The same JSON schema and conditional-logic evaluator drives both the CFP form and the speaker
portal's task forms. It runs in the browser for speed and on the server for truth, bound to a
shared fixture so the two cannot drift. Forms lock structurally once the first submission arrives:
fields stay addable, but deleting one becomes "hide from new submissions" so existing answers
survive.
</details>

Times are stored as UTC `timestamptz` and rendered in the event's timezone. Migrations are
forward-only, and CI proves each one applies and round-trips.

---

## Stack

**API** FastAPI · Python 3.12 · async end to end · SQLAlchemy 2.0 + Alembic · Postgres 16 · Redis
**Web** Next.js App Router · React 19 · TypeScript · TanStack Query · dnd-kit
**Auth** Argon2id + short-lived JWT for staff · magic links for speakers · optional GitHub OAuth

```
apps/api      router → service → models
  core/         config · db · tenancy · deps · errors · idempotency · pagination
  models/       SQLAlchemy 2.0 typed — the shared schema spine, central on purpose
  features/     one folder per capability: router · service · schemas
  jobs/         worker: reminders, scheduled mail, the nightly overdue sweep
  seed/         idempotent demo data
apps/web      public event site · admin console · speaker portal
GatherDesign  HTML prototypes that src/components/design is generated from
tools/        that generator, the design-token budget check, the prototype label wiring
```

There is no `repositories/` layer. Tenancy is enforced at the session, so a repository would only
forward calls — a file per model, buying nothing.

---

## Commands

|                 |                                                             |
| --------------- | ----------------------------------------------------------- |
| `make test`     | 369 API tests + 170 browser tests                           |
| `make test.api` | pytest only                                                 |
| `make test.e2e` | Playwright, against an isolated DB it creates and drops     |
| `make lint`     | ruff · mypy · tsc · eslint · design-token check             |
| `make db.reset` | drop, migrate, reseed                                       |
| `make types`    | regenerate the frontend's API types from the OpenAPI schema |

`make test.e2e` builds its own database and its own API and web servers on separate ports, then
tears all of it down. Browser tests never touch your development data.

`make types` is not optional politeness. Hand-writing a type that describes a response is how a
client starts lying about the server.

---

## Not built

Listed because a feature list that only lists wins is a sales page, not a README.

- **A console screen for the Accelevents push.** The API flow — configure, test connection,
  dry-run, execute — is implemented and tested. No UI reaches it; Settings says so plainly.
- **Saved views** and **custom submission statuses** — schema only.
- The agenda's scheduling assistant is a deterministic first-fit packer, not a model. The AI that
  does exist follows one rule: **AI proposes, a human accepts**, and accepting calls the same
  service method the UI does. With no `ANTHROPIC_API_KEY` a stub answers, so zero-credential local
  dev keeps working.

**Never will be:** registration, ticketing, attendee records, badging, sponsors, travel, billing,
SSO, SMS, webhooks, internationalisation, analytics dashboards.

---

## Licence

MIT — see [LICENSE](LICENSE). Fork it, run it, keep it. The invoice doesn't exist.
