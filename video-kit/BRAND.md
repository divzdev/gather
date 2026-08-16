# Gather brand book (for HyperFrames)

Everything here is extracted from the shipping app, not invented. Source of truth:
`apps/web/src/styles/tokens.css`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/icon.svg`.
If a value here disagrees with those files, those files win.

---

## 1. The one-line positioning

> Backstage production software for running a conference's speaker programme.
> Open source, MIT, self-hosted. Replaces a $40k/yr SaaS.

Tone: **instrument-grade operator console, not a marketing dashboard.** Confident, quiet,
precise. Never bubbly, never "AI-powered magic". The product's whole pitch is that it does not
guess and does not surprise you.

---

## 2. The mark

```svg
<svg viewBox="0 0 24 24" width="24" height="24" role="img" aria-label="Gather">
  <rect width="24" height="24" rx="6.5" fill="#17171C"/>
  <circle cx="14.7" cy="14.7" r="5.7" fill="#FF6B6B"/>
  <circle cx="6.3"  cy="6.3"  r="2.8" fill="#FFFFFF"/>
  <circle cx="14.4" cy="5.4"  r="2.2" fill="#FFFFFF"/>
  <circle cx="5.4"  cy="14.4" r="2.2" fill="#FFFFFF"/>
</svg>
```

**Read it as:** three small white dots (the people) converging on one large coral disc (the
talk on the stage). Squircle container, `rx` is 27% of the side.

**Rules**

- Minimum size 24px. Below that the two 2.2r dots collapse and it reads as noise.
- Clear space on all sides equals one small-dot diameter (5.6px at 24px scale).
- The container is `#17171C`, effectively black. Never recolour it, never invert it, never put
  the mark on a busy photo without the dark squircle behind it.
- Wordmark: **"Gather"**, Bricolage Grotesque 600, set at the same optical height as the mark,
  gap 12px.

### The coral is logo-only

`#FF6B6B` appears in the mark and nowhere else in the interface as an accent. The pre-2026-08-14
"coral accent" doctrine was **retired** (spec 0002). Do not tint buttons, headings, underlines or
motion trails coral to "match the brand". The chrome is black and white on purpose. If a frame
needs emphasis, use the ink pill, not the logo colour.

---

## 3. Colour

### The grammar (the part that matters most)

1. **Chrome is black and white.** No structural surface carries a hue. The only emphasis is the
   ink pill: `--bt` fill with `--bf` text.
2. **Colour is element-level state, on a strict budget.** Each hue means exactly one thing:
   - green `--ok` = **done** (accepted, sent, published)
   - amber `--pd` = **waiting on a human** (pending_send, overdue, unreviewed)
   - rose `--cn` = **wrong** (hard conflict, destructive, bounced)
   - lavender `--sg` = **in flight** (in review). Smallest allocation of the four.
3. **The background is a wash**, a pastel radial set. Cards float on it. It is atmosphere, never
   information.
4. **Neutrals are true grays in both themes.** A hue-cast dark theme is exactly how the retired
   palette ended up reading purple. Do not warm or cool the grays in post.

Never encode meaning in colour alone. Every state colour in the product is paired with a label
or an icon, and frames must preserve that pairing.

### Light (`:root`)

| Token                      | Value                             | Role                             |
| -------------------------- | --------------------------------- | -------------------------------- |
| `--pp`                     | `#f4f3f7`                         | page (flat)                      |
| `--cd`                     | `#ffffff`                         | card                             |
| `--sk`                     | `#efeff2`                         | sunk                             |
| `--ln`                     | `#e3e3e7`                         | hairline                         |
| `--ls`                     | `#c9c9cf`                         | strong line                      |
| `--ik`                     | `#141417`                         | ink                              |
| `--i2`                     | `#3f3f46`                         | secondary ink                    |
| `--i3`                     | `#54545c`                         | muted                            |
| `--i4`                     | `#5e5e66`                         | faintest, still AA on sunk       |
| `--bt` / `--bf`            | `#141417` / `#ffffff`             | primary button fill / foreground |
| `--ok` / `--okw` / `--okl` | `#177a53` / `#e4f3ec` / `#c3e3d3` | done                             |
| `--pd` / `--pdw` / `--pdl` | `#92590a` / `#faf0dc` / `#efdbb2` | waiting on a human               |
| `--cn` / `--cnw` / `--cnl` | `#b3243f` / `#fbeaee` / `#f4c8d2` | wrong                            |
| `--sg` / `--sw` / `--sl`   | `#5254b0` / `#ededfa` / `#d6d7f0` | in flight                        |

Wash (light):

```css
radial-gradient(1000px 560px at 12% -8%,  rgba(140,150,225,.14), transparent 62%),
radial-gradient(900px  520px at 88% -4%,  rgba(240,140,170,.11), transparent 60%),
radial-gradient(1100px 640px at 50% 112%, rgba(250,175,120,.13), transparent 62%), #f4f3f7
```

### Dark (`:root[data-theme="dark"]`)

| Token                      | Value                                    |
| -------------------------- | ---------------------------------------- |
| `--pp`                     | `#0d0d0f`                                |
| `--cd`                     | `#161618`                                |
| `--sk`                     | `#1d1d20`                                |
| `--ln`                     | `#27272b`                                |
| `--ls`                     | `#3b3b41`                                |
| `--ik`                     | `#f1f1f2`                                |
| `--i2`                     | `#c5c5ca`                                |
| `--i3` / `--i4`            | `#97979e` / `#8f8f96`                    |
| `--bt` / `--bf`            | `#f1f1f2` / `#141417` (the pill inverts) |
| `--ok` / `--okw` / `--okl` | `#5fc792` / `#13271c` / `#204631`        |
| `--pd` / `--pdw` / `--pdl` | `#e3b25c` / `#282013` / `#463a20`        |
| `--cn` / `--cnw` / `--cnl` | `#f27e95` / `#301820` / `#522735`        |
| `--sg` / `--sw` / `--sl`   | `#9fa1e8` / `#1e1e2e` / `#34355a`        |

Wash (dark) dims to a whisper. Dark mode **suggests** the warmth, it does not paint it.

### Track hues (agenda only)

`#3e8896` agents · `#a85788` evals · `#56789e` infrastructure · `#8a5ca8` retrieval ·
`#c4703a` multimodal · `#34526b` production.

Assigned per track and stored, so a track's colour never shifts between frames. If a session
card is teal in scene 4 it must be teal in scene 9.

### Contrast floor

Body text 4.5:1, large text and UI edges 3:1, **checked in both themes**. `tools/check_contrast.py`
holds every text pair in the product to AA. Titles you add in HyperFrames are held to the same bar.

---

## 4. Type

Four families, all loaded via `next/font` in `app/layout.tsx`:

| Family                      | Variable                | Weights       | Use                                                                                  |
| --------------------------- | ----------------------- | ------------- | ------------------------------------------------------------------------------------ |
| **Bricolage Grotesque**     | `--font-bricolage`      | 600, 700      | Display only. Big numbers, hero titles, scene cards.                                 |
| **IBM Plex Sans**           | `--font-plex-sans`      | 400, 500, 600 | Everything in the interface.                                                         |
| **IBM Plex Mono**           | `--font-plex-mono`      | 400, 500      | Metadata, timestamps, codes, keyboard hints, the quiet subtitle beside a page title. |
| **IBM Plex Sans Condensed** | `--font-plex-condensed` | 500, 600      | Small-caps section labels only.                                                      |

**Section label recipe** (used everywhere in the console, reuse it for scene labels):
Plex Sans Condensed 600, 10px, `letter-spacing: .1em`, uppercase, colour `--i4`.

**Numbers are always** `font-variant-numeric: tabular-nums`. Non-negotiable in any counter
animation: without it the digits jitter as they roll and it looks cheap.

Body line-height 1.5 minimum. Measure 75 characters maximum.

---

## 5. Geometry

```
--radius-sm 4px · --radius-md 6px · --radius-lg 10px · --radius-card 14px · --radius-pill 999px

--space-1 4  --space-2 8  --space-3 12  --space-4 16
--space-5 20 --space-6 24 --space-7 32  --space-8 40

--control-h-sm 36px   floor for any control
--control-h-md 44px   text inputs, anything touch-reachable
--control-h-lg 50px   the one irreversible action on a screen
--row-h        44px   list row
```

Card padding 20 to 24px, never under 16. Gaps: 12 to 16 between cards, 8 to 12 between controls
in a row, 20 to 28 between sections.

---

## 6. Motion

The product ships exactly one curve and three durations. **Use these, not HyperFrames defaults.**

```css
--ease: cubic-bezier(0.2, 0.8, 0.2, 1);
--dur-fast: 120ms; /* hover, focus ring, pill tint */
--dur-base: 180ms; /* panel open, row settle, chip swap */
--dur-slow: 240ms; /* drawer, route change, grid reflow */
```

Under `prefers-reduced-motion: reduce` all three collapse to `0ms`. If you export a
reduced-motion variant, it is cuts only, no eases.

**Motion principles for this brand**

- The curve is fast-out, gentle-settle. Things arrive decisively and stop without bounce.
  **No overshoot, no elastic, no spring.** An operator console that boings is not trustworthy.
- Motion explains causality: a row moves because a status changed, a ribbon appears because a
  drop created a conflict. Never move something for decoration.
- Video timings can be 2 to 4x the UI timings for legibility (a 180ms panel can take 400ms
  on screen), but the **curve stays the same**.
- Counters roll with tabular-nums, ease `--ease`, 600 to 900ms for a hero number.

---

## 7. Frame furniture (how a HyperFrames scene should be dressed)

- **Background:** the wash, not flat white. It is the single thing that makes the product look
  designed rather than generated.
- **Screenshot treatment:** `--radius-card` (14px), 1px `--ln` hairline, and a soft drop shadow
  `0 12px 32px rgba(16,19,25,.16)` (the product's own toast shadow). Never a hard black border.
- **Scene label:** the small-caps recipe from section 4, top-left, `--i4`.
- **Callouts:** tinted pill in the matching state colour (`--okw` bg / `--ok` text, etc), never
  bare coloured text, never a red circle-and-arrow.
- **Lower third / captions:** Plex Sans 500, on `--cd` with `--ln` hairline, `--radius-lg`.
- **Never** put marketing gradients, glows, lens flares, or a coral tint over a screenshot.

---

## 8. Voice for on-screen copy

- Say the real noun. "Call for papers", not "Intake". "Speaker", not "User".
- Prefer the product's own sentence to a slogan. The app already writes well: _"Answers come
  from live queries against this event. It reads; it never changes anything."_ is better than
  anything a marketing pass would produce. Lift copy from the UI wherever possible.
- Numbers over adjectives. "297 proposals, 121 unreviewed" beats "powerful review tools".
- British-leaning spelling in product copy ("organisation", "programme") because that is what
  the UI ships. Stay consistent with the screenshots on screen.

---

## 9. Glossary (use these exact terms)

| Term                         | Meaning                                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Decision/send separation** | Recording an outcome (`pending_send`) versus emailing it (`sent`). The most important rule in the product. |
| **`code`**                   | 6-char human-readable submission ID. A lookup key, not a secret.                                           |
| **`conflict_key`**           | Order-independent hash identifying one conflict instance, so a dismissal survives unrelated edits.         |
| **Version group**            | All versions of one logical file. Kills the `final_v3_revised_EDITED.docx` problem.                        |
| **Blind review**             | Identity fields stripped at the API for reviewer tokens. Enforced server-side, not in the UI.              |
| **Query catalog**            | The twelve read-only queries the event assistant is allowed to name.                                       |
| **Unscheduled tray**         | The left column on the agenda holding sessions with no slot yet.                                           |
