# Gather launch film: shooting script and storyboard

**Target length:** 105 to 120 seconds
**Aspect:** 16:9, 1920x1080. A 9:16 cutdown is noted per scene where it works.
**Design contract:** every frame obeys `video-kit/BRAND.md`. One curve
(`cubic-bezier(.2,.8,.2,1)`), no overshoot, no coral tint, wash background, tabular numerals.
**Assets:** `video-kit/screenshots/`. Numbers quoted in VO are the real numbers in those shots.

A note on the arc: this is not a feature tour. It is **one conference going from 297 proposals
to a published programme**, and the software is what makes each step survivable. Two moments
carry the whole film: the send confirmation (scene 6) and the conflicting drop (scene 8). If
budget is tight, protect those.

---

## Scene 1 — Cold open: the cost

**0:00 to 0:07 · 7s** · no screenshot, typographic only

|               |                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------- |
| **On screen** | `$40,000 / year` then, struck through, `$0`                                                       |
| **VO**        | "Running a conference's speaker programme costs about forty thousand dollars a year in software." |
| **Label**     | none                                                                                              |

**Visual.** Wash background, light. Bricolage Grotesque 700 at roughly 180px, ink `--ik`,
centred, tabular-nums. Nothing else in frame.

**Animation.**

1. `$40,000 / year` counts up 0 to 40,000 over 900ms, `--ease`, tabular-nums so the digits do
   not jitter.
2. Hold 1.2s.
3. A 2px `--cn` rule draws left to right through the number over 240ms.
4. The struck number drops to `--i4` and scales to 0.7 over 180ms as `$0` arrives beneath in
   `--ok`, rising 12px into place.

**9:16:** works unchanged, stack the two numbers.

---

## Scene 2 — The premise

**0:07 to 0:14 · 7s** · `01-signin.jpg`

|               |                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **On screen** | `Every talk on that stage started here.` (already in the shot)                                                             |
| **VO**        | "Every talk that ends up on a stage started as a proposal in somebody's inbox. Gather is where that whole pipeline lives." |
| **Label**     | `OPEN SOURCE · MIT`                                                                                                        |

**Visual.** Full-bleed use of the sign-in screen. It is already cinematic: dark auditorium
photograph left, sign-in panel right. Do not add a gradient, it has one.

**Animation.** Slow push in, 1.03 to 1.00 scale across the full 7s, linear (a Ken Burns move,
not an ease). At 4.5s the three demo-login pills (`Organizer` `Reviewer` `Speaker`) get a
staggered 120ms `--dur-fast` highlight, 80ms apart, to plant that there are three audiences.

**Design note.** The stat line reads `214 proposals · 61 sessions · 80 speakers`. Leave it
legible, it is doing quiet credibility work.

---

## Scene 3 — The console

**0:14 to 0:23 · 9s** · `02-overview.jpg`

|               |                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| **On screen** | `59% ready for May`                                                                                           |
| **VO**        | "One console. It opens on the only question that matters the week before a conference: what is not done yet." |
| **Label**     | `THE CONSOLE`                                                                                                 |

**Visual.** Screenshot in a 14px-radius card, 1px `--ln` hairline, shadow
`0 12px 32px rgba(16,19,25,.16)`, floating on the wash with roughly 8% margin.

**Animation.**

1. Card rises 24px into place, 240ms `--ease`, opacity 0 to 1.
2. The Program Pulse bar fills 0 to 59% over 800ms, `--ease`, starting 200ms after the card lands.
3. The four counters in the strip (`SUB 297`, `UNREVIEWED 121`, `DECIDED 127`, `OVERDUE TASKS 80`)
   count up simultaneously over 700ms, tabular-nums.
4. At 6s, the `2 CONFLICTS` chip in rose does one 120ms tint pulse. Do not loop it.

**Design note.** Each of those four numbers is a different state colour and that is the point.
Amber is waiting on a human, rose is wrong. Hold the frame long enough to read the pairing.

---

## Scene 4 — Intake

**0:23 to 0:33 · 10s** · `03-submissions.jpg`

|               |                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **On screen** | `297 proposals · one form you built yourself`                                                                                           |
| **VO**        | "Proposals arrive through a form you built, and land in one table. Score, track, format, status, all sortable, all shareable as a URL." |
| **Label**     | `CALL FOR PAPERS`                                                                                                                       |

**Visual.** Same card treatment. Frame tight on the table so the rows fill the width.

**Animation.**

1. Rows cascade in from the top, 8 rows, 40ms apart, each 180ms `--ease`, translateY 8px.
2. At 4s, a soft focus rectangle (2px `--sg`, `--radius-md`) travels down the `SCORE` column,
   pausing on the 5.0, then the 4.9, then the 4.8.
3. At 7s, the green `Accepted` pills tint-pulse together, 120ms.

**Design note.** Do not crop out the track pills. Three distinct tracks in three stored hues is
what sells that this is real data and not a mock.

---

## Scene 5 — Review

**0:33 to 0:42 · 9s** · `05-review-evaluators.jpg`

|               |                                                                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **On screen** | `411 of 441 reviews in · nobody behind`                                                                                                                              |
| **VO**        | "Reviewers get a keyboard-driven queue of only their own assignments. Blind review is enforced at the API, so a reviewer cannot see a name even if they go looking." |
| **Label**     | `REVIEW`                                                                                                                                                             |

**Visual.** Card treatment. Emphasis on the evaluator table, the progress bars are the story.

**Animation.**

1. The three evaluator progress bars fill left to right, staggered 120ms apart, 700ms each,
   `--ease`.
2. `219/219` and `192/222` count up in sync with their bars.
3. The `Done` and `On pace` pills fade in at bar completion, 120ms.

**Design note.** The `Send reminder` button on the trailing row is amber-tinted. That is the
"waiting on a human" colour doing its job. Keep it in frame.

---

## Scene 6 — The rule that defines the product

**0:42 to 0:54 · 12s** · typographic, no screenshot (or a tight crop of the decisions strip)

|               |                                                                                                                                                                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **On screen** | Beat 1: `Deciding` · Beat 2: `Deciding ≠ Sending` · Beat 3: `0 decided, not sent`                                                                                                                                                                                                                                                       |
| **VO**        | "Here is the rule the whole product is built around. Setting a decision emails nobody. It writes a status and stops. Sending is a separate, deliberate act, and the server recounts the recipients before it will go. The worst accident in this job, mass-emailing the wrong outcome from a stale screen, is structurally impossible." |
| **Label**     | `THE ONE RULE`                                                                                                                                                                                                                                                                                                                          |

**Visual.** The most designed frame in the film. Wash background. Two words in Bricolage 700,
`Deciding` in ink, `Sending` in ink, separated by a large `≠` in `--cn`.

**Animation.**

1. `Deciding` types or fades in, 180ms.
2. 600ms hold. `≠` scales 0.8 to 1.0 with a 240ms `--ease`, colour `--cn`. **No bounce.**
3. `Sending` slides in from the right, 240ms.
4. A rose hairline draws between them, 300ms, then holds.
5. Final beat: everything drops to `--i4` and the `0 · Decided, not sent` counter card from the
   Submissions screen rises into centre frame, ink, tabular-nums.

**Why 12 seconds.** This is the idea a judge remembers. Give it room, and let the VO breathe.

---

## Scene 7 — Chasing

**0:54 to 1:02 · 8s** · `06-tasks.jpg`

|               |                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **On screen** | `190 open · 80 overdue · 91 speakers waiting`                                                                                                                                           |
| **VO**        | "Then you chase eighty speakers for headshots and slides. Overdue is computed, never a status somebody forgot to set, and a nudge has a twenty-four hour floor so nobody gets spammed." |
| **Label**     | `DELIVERABLES`                                                                                                                                                                          |

**Animation.**

1. Card rises in, 240ms.
2. The four deliverable progress bars (`21/61`, `21/92`, `22/61`, `21/61`) fill in a 100ms
   stagger, 600ms each.
3. At 5s, push in 1.0 to 1.06 on the overdue rows at the bottom so the amber `8d overdue` and
   the `Remind` buttons read clearly.

**Design note.** The `20 overdue` count at the section head is rose, the per-row `8d overdue`
is amber. That is not an inconsistency: rose is the aggregate alarm, amber is the individual
waiting-on-a-human. Do not "fix" it in post.

---

## Scene 8 — The agenda (hero)

**1:02 to 1:16 · 14s** · `04-agenda-conflicts.jpg`

|               |                                                                                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **On screen** | Beat 1: `drag to place` · Beat 2: `3 conflicts` · Beat 3: `the drop is always accepted`                                                                                                                                                                                                         |
| **VO**        | "Then you build the grid. Drag a talk into a room and the conflicts are computed before the drop lands. Room double-booked, speaker in two places, tracks colliding. And the drop still succeeds. The software never silently refuses you. It tells you what you just did and lets you decide." |
| **Label**     | `AGENDA`                                                                                                                                                                                                                                                                                        |

**Visual.** The widest frame in the film. Show the unscheduled tray, the grid, and the conflict
inspector together. This shot is the product.

**Animation.** This is the one scene worth building as a real animation rather than a pan.

1. 0.0s: grid present, tray present, inspector hidden.
2. 1.0s: a ghost card lifts from the tray (scale 1.02, shadow deepens, 180ms) and travels to the
   16:00 Main Stage cell along a slight arc, 700ms `--ease`.
3. 1.7s: on drop, the cell's border snaps to `--cn` rose, 120ms. **The card stays.** This is the
   entire point of the scene: it landed.
4. 1.9s: the conflict inspector slides in from the right, 240ms `--ease`, and its three cards
   (`ROOM`, `SPEAKER`, `TRACK · SOFT`) stagger in 80ms apart.
5. 3.0s: the header chip flips `2 CONFLICTS` to `3 CONFLICTS` with a 120ms tint pulse.
6. Hold on the full frame for the rest of the VO.

**Design note.** `TRACK · SOFT` is labelled soft because track collision is a soft conflict and
can be disabled. If you add a callout, say "soft", do not imply all three are equally fatal.

---

## Scene 9 — Publish

**1:16 to 1:24 · 8s** · `07-publishing-embed.jpg` into `08-public-event.jpg`

|               |                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **On screen** | `one script tag · under 40KB · always current`                                                                                                          |
| **VO**        | "Publishing writes an immutable snapshot. The public site and the embed read only that snapshot, so what the world sees is never a half-finished edit." |
| **Label**     | `PUBLISH`                                                                                                                                               |

**Animation.**

1. Publishing screen, card treatment, 2s. The embed code block gets a 120ms highlight sweep.
2. **Match cut** on the `View public page` button to the public event page, full bleed, 240ms
   cross-dissolve.
3. Public page holds 4s with a slow 1.02 to 1.00 push. The stat row (`61 / 61 / 8 / 2`) counts up
   over 700ms, tabular-nums.

**Design note.** The public page is the only place in the film where display type goes truly
large. Let it. It is the payoff for the console being restrained.

**9:16:** the public page hero crops beautifully. Use it as the vertical thumbnail.

---

## Scene 10 — The speaker's side

**1:24 to 1:32 · 8s** · `09-portal-light.jpg` and `10-portal-dark.jpg`

|               |                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **On screen** | `No password. Ever.`                                                                                                                                                         |
| **VO**        | "Speakers never get an account. Email is identity, a magic link is the whole login, and the portal is built for the two minutes they will actually spend on it, on a phone." |
| **Label**     | `SPEAKER PORTAL`                                                                                                                                                             |

**Animation.**

1. Light portal in, card treatment, 240ms.
2. The five-step progress rail animates: each completed node pops from scale 0.6 to 1.0, 180ms,
   staggered 100ms, and the connector between them draws in `--stepLn` green.
3. At 5s, **theme wipe**: a soft vertical wipe left to right over 400ms swaps to
   `10-portal-dark.jpg`. Same layout, same geometry, different map.

**Design note.** The theme wipe is the cheapest possible way to show the dark palette is a real
first-class map and not an inverted filter. Keep the wipe soft-edged, roughly 80px feather.

---

## Scene 11 — The assistant

**1:32 to 1:44 · 12s** · `11-ask-drawer-empty.jpg` → `12-ask-streaming.jpg` → `13-ask-answered.jpg`

|               |                                                                                                                                                                                                                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **On screen** | `It cannot make anything up.`                                                                                                                                                                                                                                                                               |
| **VO**        | "There is an assistant, and it is deliberately not a chatbot. It cannot answer from memory. It can only name one of twelve read-only queries, which the server then runs itself. Every number on screen came out of Postgres a moment ago, and a question outside those twelve is refused in one sentence." |
| **Label**     | `ASK`                                                                                                                                                                                                                                                                                                       |

**Visual.** The drawer open over the agenda. The status line under the composer
(`provider · model · spend against the cap`) must be legible: it is the proof.

**Animation.**

1. Drawer slides in from the right, 240ms `--ease`.
2. Question chip is clicked, question rises into the thread as a right-aligned bubble, 180ms.
3. A `queries` row appears naming the catalog entries that ran, 120ms, in `--sw` lavender tint.
4. The prose answer types in, roughly 30ms per word, capped at 2.5s total.
5. Hold on the status line for the last 2s.

**The real answer, captured in `13-ask-answered.jpg`** (use this verbatim, do not paraphrase it):

> There are 3 conflicts on the agenda, all at 2027-05-12T16:00:00+00:00 with 2 sessions each. The
> hard conflicts are room Main Stage and speaker Ulla Alvarez, and the soft conflict is track
> Platform & Infra.
>
> `Looked at agenda conflicts`

Status line reads `Meta Muse Spark · muse-spark-1.2-contributor · 4/200 today · 2,718 tok · 45.9s`.

**This is the callback that sells the whole film.** Those are the _same three conflicts_ the
inspector shows in scene 8: Main Stage, Ulla Alvarez, Platform & Infra. Cut scene 11 so the viewer
recognises them. If you can afford one extra beat, flash back to the scene 8 inspector for 400ms
under the answer. Nothing proves "it queried rather than guessed" more cheaply than the same three
names arriving twice from two different screens.

Two things to handle in the edit:

- **45.9s is the real latency** on the contributor tier. Cut around it. Never imply it is instant,
  but do not make the viewer sit through it either: the honest edit is a visible "Working out what
  to look at…" beat (that is the app's real copy, in `12-ask-streaming.jpg`) then a cut to the
  answer.
- The answer prints a raw UTC timestamp, `2027-05-12T16:00:00+00:00`, rather than a formatted
  event-local time. It is legible but it is not how the rest of the product writes a time. Either
  frame tight to avoid it, or accept it. Flagged as a defect below.

---

## Scene 12 — Close

**1:44 to 1:55 · 11s** · typographic

|               |                                                                                                                                                                  |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **On screen** | `Gather` mark + wordmark, then `make setup && make dev`, then `MIT · self-hosted · zero credentials`                                                             |
| **VO**        | "It is open source, MIT licensed, and it runs on your own box. Clone it, run two commands, and you get a seeded conference with no API keys and nothing to buy." |
| **Label**     | none                                                                                                                                                             |

**Animation.**

1. Wash background. The mark assembles: squircle fades in 180ms, then the three white dots
   pop in 100ms apart, then the coral disc scales 0.8 to 1.0 last, 240ms. This is the only
   moment coral appears in the film, and it lands on the logo.
2. Wordmark slides in from the left of the mark, 240ms.
3. `make setup && make dev` types in Plex Mono beneath, 40ms per character.
4. Final line fades up in `--i4`, 180ms. Hold 2s on black-on-wash.

---

## Shot list summary

| #   | Asset                                             | Duration | Type                   |
| --- | ------------------------------------------------- | -------- | ---------------------- |
| 1   | typographic                                       | 7s       | build                  |
| 2   | `01-signin.jpg`                                   | 7s       | full bleed             |
| 3   | `02-overview.jpg`                                 | 9s       | card                   |
| 4   | `03-submissions.jpg`                              | 10s      | card                   |
| 5   | `05-review-evaluators.jpg`                        | 9s       | card                   |
| 6   | typographic                                       | 12s      | build **(protect)**    |
| 7   | `06-tasks.jpg`                                    | 8s       | card                   |
| 8   | `04-agenda-conflicts.jpg`                         | 14s      | animated **(protect)** |
| 9   | `07-publishing-embed.jpg` → `08-public-event.jpg` | 8s       | match cut              |
| 10  | `09-portal-light.jpg` → `10-portal-dark.jpg`      | 8s       | theme wipe             |
| 11  | `11-ask-drawer-empty` → `12` → `13-ask-answered`  | 12s      | animated **(protect)** |
| 12  | typographic                                       | 11s      | build                  |

Total 115s.

---

## Known asset defects (fix before final render)

1. **The assistant prints a raw UTC timestamp** in its prose (`2027-05-12T16:00:00+00:00`) instead
   of a time formatted in the event timezone. Everywhere else the product stores UTC and formats
   with `event_timezone`; the answer prose does not. Cosmetic for the film, a real inconsistency in
   the product. Frame tight or accept it.
2. **`07-publishing-embed.jpg`**: the Tracks chip row contains seeded speaker names
   (`Roary Buckley`, `Berk Whitfield`, `Nero Roberson`, `Aurora Summers`) sitting alongside real
   tracks. Frame above that card, or reshoot after cleaning the seed.
3. **`09-portal-light.jpg` / `10-portal-dark.jpg`**: the headshot thumbnail is an uploaded
   screenshot of a dark chart, not a portrait. Crop it out or reshoot with a real image.
4. **Submissions sorted by date** puts E2E test rows on top (`Double submit 1786801776429`,
   speakers called `Limited Tester`). `03-submissions.jpg` is sorted by **score descending** to
   avoid this. If you reshoot any list view, sort by score first.
5. All shots are 1470x812. For a 1920x1080 timeline either upscale 1.31x (acceptable for
   screenshots at this DPI) or reshoot at a 1920-wide window.
