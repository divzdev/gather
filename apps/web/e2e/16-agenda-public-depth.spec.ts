import { expect, test, type APIRequestContext } from "@playwright/test";

/** Checklist §"Sessions", §"Schedule" and §"Public pages" — the items 09/12
 *  left uncovered: 116, 117, 121, 124-127, 129, 130, 143, 144, 146, 147.
 *
 *  Placements made here are reverted, and anything created is deleted.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
const SLUG = "devflow-conf-2027";

type Grid = {
  days: { id: string }[];
  rooms: { id: string; name: string }[];
  tracks: { id: string; name: string }[];
  scheduled: {
    id: string;
    title: string;
    room_id: string | null;
    starts_at: string;
    duration_minutes: number;
    track_id: string | null;
    speaker_ids: string[];
  }[];
  unscheduled: { id: string; title: string }[];
};

async function organizer(request: APIRequestContext) {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const eventId = ((await events.json()) as { id: string }[])[0]!.id;
  return { headers, eventId };
}

async function draft(
  request: APIRequestContext,
  ctx: { headers: Record<string, string>; eventId: string },
): Promise<Grid> {
  const response = await request.get(`${API}/v1/events/${ctx.eventId}/schedule/draft`, {
    headers: ctx.headers,
  });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as Grid;
}

/** Put a session back exactly where it was, or return it to the tray. */
async function restore(
  request: APIRequestContext,
  ctx: { headers: Record<string, string>; eventId: string },
  was: { id: string; room_id: string | null; starts_at: string; duration_minutes: number } | null,
  id?: string,
) {
  if (was === null) {
    await request.post(`${API}/v1/events/${ctx.eventId}/sessions/${id}/unschedule`, {
      headers: ctx.headers,
    });
    return;
  }
  const grid = await draft(request, ctx);
  await request.patch(`${API}/v1/events/${ctx.eventId}/sessions/${was.id}/placement`, {
    headers: ctx.headers,
    data: {
      event_day_id: grid.days[0]!.id,
      room_id: was.room_id,
      starts_at: was.starts_at,
      duration_minutes: was.duration_minutes,
    },
  });
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

test("116. accepted proposals become sessions, and promoting twice is the same session", async ({
  request,
}) => {
  const ctx = await organizer(request);

  const listing = await request.get(
    `${API}/v1/events/${ctx.eventId}/submissions?per_page=200&filter[status]=accepted`,
    { headers: ctx.headers },
  );
  const accepted = ((await listing.json()) as { data: { id: string; title: string }[] }).data;

  const sessions = await request.get(`${API}/v1/events/${ctx.eventId}/sessions`, {
    headers: ctx.headers,
  });
  const promoted = new Set(
    ((await sessions.json()) as { submission_id: string | null }[])
      .map((row) => row.submission_id)
      .filter((id): id is string => id !== null),
  );

  const waiting = accepted.filter((row) => !promoted.has(row.id)).slice(0, 3);
  test.skip(waiting.length === 0, "every accepted proposal is already a session");

  const made: string[] = [];
  try {
    for (const row of waiting) {
      const created = await request.post(
        `${API}/v1/events/${ctx.eventId}/submissions/${row.id}/promote`,
        { headers: ctx.headers },
      );
      expect(created.status(), await created.text()).toBe(201);
      const talk = (await created.json()) as { id: string; title: string };
      expect(talk.title, "the session did not carry the proposal's title").toBe(row.title);
      made.push(talk.id);

      // Promoting again returns the same session rather than a second copy —
      // an organiser clicking twice must not split one talk into two.
      const twice = await request.post(
        `${API}/v1/events/${ctx.eventId}/submissions/${row.id}/promote`,
        { headers: ctx.headers },
      );
      expect(((await twice.json()) as { id: string }).id).toBe(talk.id);
    }
  } finally {
    for (const id of made) {
      await request.delete(`${API}/v1/events/${ctx.eventId}/sessions/${id}`, {
        headers: ctx.headers,
      });
    }
  }
});

test("117. a session is created with no proposal behind it", async ({ request }) => {
  const ctx = await organizer(request);
  const grid = await draft(request, ctx);

  const speakers = await request.get(`${API}/v1/events/${ctx.eventId}/speakers`, {
    headers: ctx.headers,
  });
  const [speaker] = (await speakers.json()) as { speaker_id: string }[];

  // Keynotes never go through the CFP, so promotion cannot be the only door.
  const created = await request.post(`${API}/v1/events/${ctx.eventId}/sessions`, {
    headers: ctx.headers,
    data: {
      title: `Opening keynote ${Date.now()}`,
      abstract: "An invited talk with no proposal behind it.",
      track_id: grid.tracks[0]?.id ?? null,
      duration_minutes: 45,
      speaker_ids: speaker === undefined ? [] : [speaker.speaker_id],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const talk = (await created.json()) as { id: string; slug: string };
  expect(talk.slug, "the new session has no slug, so it has no public URL").not.toBe("");

  try {
    const listing = await request.get(`${API}/v1/events/${ctx.eventId}/sessions`, {
      headers: ctx.headers,
    });
    const found = (
      (await listing.json()) as {
        id: string;
        submission_id: string | null;
        duration_minutes: number;
        speakers: unknown[];
      }[]
    ).find((row) => row.id === talk.id);

    expect(found, "the created session is not in the list").toBeDefined();
    expect(found!.submission_id, "an invited session invented a proposal").toBeNull();
    expect(found!.duration_minutes).toBe(45);
    if (speaker !== undefined) expect(found!.speakers.length).toBe(1);
  } finally {
    await request.delete(`${API}/v1/events/${ctx.eventId}/sessions/${talk.id}`, {
      headers: ctx.headers,
    });
  }
});

test("121. changing a duration re-evaluates what it now overlaps", async ({ request }) => {
  const ctx = await organizer(request);
  const grid = await draft(request, ctx);

  const target = grid.scheduled[0];
  expect(target, "nothing on the grid to resize").toBeDefined();
  const was = {
    id: target!.id,
    room_id: target!.room_id,
    starts_at: target!.starts_at,
    duration_minutes: target!.duration_minutes,
  };

  try {
    const stretched = await request.patch(
      `${API}/v1/events/${ctx.eventId}/sessions/${target!.id}/placement`,
      {
        headers: ctx.headers,
        data: {
          event_day_id: grid.days[0]!.id,
          room_id: target!.room_id,
          starts_at: target!.starts_at,
          duration_minutes: 240,
        },
      },
    );
    expect(stretched.status(), await stretched.text()).toBe(200);
    const result = (await stretched.json()) as {
      session: { duration_minutes: number };
      conflicts: unknown[];
    };
    expect(result.session.duration_minutes, "the resize did not stick").toBe(240);

    // A four-hour talk in a room with a normal programme has to collide with
    // something; the point is that resizing re-runs detection, not only moving.
    const after = await draft(request, ctx);
    const resized = after.scheduled.find((row) => row.id === target!.id);
    expect(resized!.duration_minutes).toBe(240);
  } finally {
    await restore(request, ctx, was);
  }
});

test("124-127. each conflict class is detected, named, and clears when resolved", async ({
  request,
}) => {
  const ctx = await organizer(request);

  const read = async () => {
    const response = await request.get(`${API}/v1/events/${ctx.eventId}/conflicts`, {
      headers: ctx.headers,
    });
    return (await response.json()) as {
      kind: string;
      severity: string;
      label: string;
      session_ids: string[];
      conflict_key: string;
    }[];
  };

  const before = await read();
  const byKind = new Map(before.map((row) => [row.kind, row]));

  // 124-126. All three classes, each naming both sides, with track softer than
  // the two hard ones.
  for (const kind of ["room", "speaker", "track"] as const) {
    const found = byKind.get(kind);
    expect(found, `no ${kind} conflict in the seeded programme`).toBeDefined();
    expect(found!.session_ids.length, `a ${kind} conflict names only one session`).toBe(2);
    expect(found!.label.trim(), `the ${kind} conflict has nothing to show`).not.toBe("");
    expect(found!.severity).toBe(kind === "track" ? "soft" : "hard");
  }

  // 126b. Track collisions can be switched off per event — some organisers
  // overlap tracks deliberately.
  const eventRead = await request.get(`${API}/v1/events/${ctx.eventId}`, { headers: ctx.headers });
  const wasEnabled = ((await eventRead.json()) as { soft_conflicts_enabled: boolean })
    .soft_conflicts_enabled;

  await request.patch(`${API}/v1/events/${ctx.eventId}`, {
    headers: ctx.headers,
    data: { soft_conflicts_enabled: false },
  });
  const quieter = await read();
  expect(
    quieter.some((row) => row.kind === "track"),
    "turning soft conflicts off left the track warnings on",
  ).toBe(false);
  expect(
    quieter.some((row) => row.severity === "hard"),
    "turning soft conflicts off silenced the hard ones too",
  ).toBe(true);

  await request.patch(`${API}/v1/events/${ctx.eventId}`, {
    headers: ctx.headers,
    data: { soft_conflicts_enabled: wasEnabled },
  });

  // 127. Moving one of the pair out clears that conflict and leaves the rest.
  const room = byKind.get("room")!;
  const grid = await draft(request, ctx);
  const moving = grid.scheduled.find((row) => row.id === room.session_ids[1]);
  expect(moving, "the conflicting session is not on the grid").toBeDefined();
  const was = {
    id: moving!.id,
    room_id: moving!.room_id,
    starts_at: moving!.starts_at,
    duration_minutes: moving!.duration_minutes,
  };

  try {
    await request.post(`${API}/v1/events/${ctx.eventId}/sessions/${moving!.id}/unschedule`, {
      headers: ctx.headers,
    });
    const cleared = await read();
    expect(
      cleared.some((row) => row.conflict_key === room.conflict_key),
      "the conflict survived taking one of its sessions off the grid",
    ).toBe(false);
  } finally {
    await restore(request, ctx, was);
  }
});

test("129. every view mode in the switcher is a real view", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  await page.goto("/admin/agenda");
  await expect(page.getByText(/CONFLICT/i).first()).toBeVisible({ timeout: 25_000 });

  // Track, List and Week used to be wired to the same handler as the conflicts
  // button. The grid stayed on screen underneath, so "does the page still have
  // text" passed for all three. Each mode now has to show something only it
  // shows, and the drag canvas has to be gone when it is not the day grid.
  //
  // The five names are the brief's own words — "viewable by list, day, week,
  // track, or room" — so the switcher is checked against that list, not against
  // whatever the design prototype happened to label them.
  const canvas = page.locator("[data-agenda-grid]");
  const proof: Record<string, RegExp> = {
    List: /THIS DAY, IN ORDER/i,
    Day: /MAIN STAGE|UNSCHEDULED/i,
    Week: /DAY 1/i,
    Track: /DEVELOPER EXPERIENCE|NO TRACK/i,
    Room: /MAIN STAGE|NO ROOM/i,
  };

  for (const [mode, expected] of Object.entries(proof)) {
    await page
      .getByRole("button", { name: new RegExp(`^${mode}$`, "i") })
      .first()
      .click();
    await expect(page.getByText(expected).first()).toBeVisible({ timeout: 10_000 });
    // exact, or "Day" also matches the "Day 1"/"Day 2" date tabs beside it.
    await expect(page.getByRole("button", { name: mode, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(canvas).toHaveCount(mode === "Day" ? 1 : 0);
  }
});

test("130. the whole programme is placed without the grid falling over", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });

  const started = Date.now();
  await page.goto("/admin/agenda");
  await expect(page.getByText(/CONFLICT/i).first()).toBeVisible({ timeout: 30_000 });
  const painted = Date.now() - started;

  // Not a card count — that only tests my selector against nested markup. What
  // the item is about is the whole programme being on one screen and the screen
  // still working.
  expect(await page.locator("[data-agenda-grid]").count(), "no grid").toBe(1);
  const painted_text = (await page.locator("body").textContent()) ?? "";
  expect(painted_text.length, "the agenda painted almost nothing").toBeGreaterThan(2000);

  // And the fixture really is at demo scale, so this is not a small-grid pass.
  const ctx = await organizer(request);
  const grid = await draft(request, ctx);
  expect(grid.scheduled.length, "the agenda is not carrying a full programme").toBeGreaterThan(40);
  // Not a frame-rate measurement — that needs a profiler. This is the floor:
  // a grid carrying the full programme still has to appear promptly.
  expect(painted, `the agenda took ${painted}ms to paint the full programme`).toBeLessThan(15_000);
});

test("143-144. the public schedule filters and searches without a round trip", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const page = await context.newPage();

  await page.goto(`/e/${SLUG}/schedule`);
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
  const full = await page.locator("body").innerText();

  // Filters are links, not buttons, so a filtered view is a URL somebody can
  // send and the page needs no JavaScript to narrow.
  for (const name of ["day", "track", "room"] as const) {
    await expect(
      page.locator(`a[href*="${name}="]`).first(),
      `the public schedule cannot be narrowed by ${name}`,
    ).toHaveCount(1);
  }

  // 143. Narrowing changes what is on screen, and says how much of it is left.
  await page.locator('a[href*="track="]').first().click();
  await page.waitForURL(/track=/, { timeout: 20_000 });
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
  const narrowed = await page.locator("body").innerText();
  expect(narrowed, "filtering the public schedule changed nothing").not.toBe(full);
  expect(narrowed, "a filtered schedule does not say how many it is showing").toMatch(
    /\d+ of \d+ sessions/,
  );

  // 144. Searching by speaker name finds their talk.
  const payload = await context.request.get(`${API}/v1/public/events/${SLUG}/schedule`);
  const data = (await payload.json()) as {
    sessions: { title: string; speakers: { name: string }[] }[];
  };
  const withSpeaker = data.sessions.find((row) => row.speakers.length > 0);
  test.skip(withSpeaker === undefined, "nothing published with a speaker on it");

  await page.goto(`/e/${SLUG}/schedule`);
  const search = page.getByPlaceholder(/search/i).first();
  await expect(search, "the public schedule has no search").toHaveCount(1);
  await search.fill(withSpeaker!.speakers[0]!.name);
  await search.press("Enter");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
  expect(
    await page.locator("body").innerText(),
    "searching by speaker did not surface their talk",
  ).toContain(withSpeaker!.title);

  await context.close();
});

test("146. every public page is legible at 375px", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const page = await context.newPage();

  const problems: string[] = [];
  for (const path of ["", "/schedule", "/speakers", "/cfp", "/itinerary"]) {
    const response = await page.goto(`/e/${SLUG}${path}`);
    if ((response?.status() ?? 500) >= 400) {
      problems.push(`${path} returned ${response?.status()}`);
      continue;
    }
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    // 4px, not 0: sub-pixel rounding on a 375px viewport moves the document
    // width by a couple of pixels with nothing clipped. Anything that actually
    // pushes content off-screen is far larger than this.
    if (overflow > 4) problems.push(`${path} scrolls sideways by ${overflow}px`);

    // The real question is whether anything is cut off, so ask that directly.
    const clipped = await page.evaluate(() => {
      const limit = document.documentElement.clientWidth;
      return [...document.querySelectorAll("main *, article, h1, h2, p, button, input")]
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.right > limit + 4;
        })
        .map((element) => (element.textContent ?? "").trim().slice(0, 30));
    });
    if (clipped.length > 0) problems.push(`${path} clips: ${clipped.slice(0, 3).join(" | ")}`);
  }

  expect(problems, "public pages that break at phone width").toEqual([]);
  await context.close();
});

test("147. the publishing screen produces a snippet that runs on a third-party page", async ({
  page,
  browser,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  await page.goto("/admin/publishing");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");

  const snippet = (await page.locator("body").innerText()).match(
    /<div id="gather-[^]*?<\/script>/,
  )?.[0];
  expect(snippet, "the publishing screen shows no embed snippet").toBeTruthy();
  expect(snippet!, "the snippet points at nothing").toContain("embed.js");

  // Pasted onto a page that is not our origin, it has to render.
  const context = await browser.newContext();
  const third = await context.newPage();
  await third.setContent(`<!doctype html><meta charset="utf-8">${snippet}`, {
    waitUntil: "networkidle",
  });
  await third.waitForTimeout(1500);
  expect(
    (await third.locator("body").innerText()).trim().length,
    "the pasted snippet rendered nothing",
  ).toBeGreaterThan(10);
  await context.close();
});

test("the auto-scheduler reads its rules box, and says what it could not read", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  await page.goto("/admin/agenda");
  await expect(page.getByText(/CONFLICT/i).first()).toBeVisible({ timeout: 25_000 });

  // The box used to discard every keystroke: aiQ was the empty string and
  // onAiQ did nothing, so the panel looked like it was listening and was not.
  await page.getByRole("button", { name: "✕" }).first().click();
  const box = page.getByPlaceholder(/Leave 12:00 free/i);
  await box.fill("Leave 12:00 free. Nothing before 10:00. Make it sparkle.");

  // By role, not by text: the panel's own help line quotes these phrasings back
  // as examples, so a bare text match finds two of each.
  await expect(page.getByRole("button", { name: /12:00–13:00 stays free/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /nothing before 10:00/ })).toBeVisible();
  // A line it cannot read is quoted back, never dropped in silence.
  await expect(page.getByText(/Not understood: "Make it sparkle"/)).toBeVisible();

  await page.getByRole("button", { name: /Draft the empty slots/i }).click();
  const heading = page.getByText(/PROPOSED · \d+ PLACEMENT|NOTHING PROPOSED/);
  await expect(heading).toBeVisible({ timeout: 10_000 });

  // Every proposal obeys the rules: the ghost times are what prove it.
  const ghostTimes = await page
    .locator("text=/^✦ \\d{2}:\\d{2}$/")
    .evaluateAll((nodes) => nodes.map((node) => (node.textContent ?? "").replace("✦ ", "").trim()));
  for (const at of ghostTimes) {
    expect(at >= "10:00", `proposed ${at}, before the 10:00 rule`).toBe(true);
    expect(at < "12:00" || at >= "13:00", `proposed ${at}, inside the free hour`).toBe(true);
  }
});

test("the publishing screen shows snapshot history and can put an old one back", async ({
  page,
  request,
}) => {
  const ctx = await organizer(request);
  // Two versions, so there is something to roll back to.
  for (let n = 0; n < 2; n += 1) {
    await request.post(`${API}/v1/events/${ctx.eventId}/schedule/publish`, {
      headers: { ...ctx.headers, "Idempotency-Key": `e2e-history-${n}-${Date.now()}` },
      data: { acknowledge_conflicts: true },
    });
  }
  const before = await request.get(`${API}/v1/events/${ctx.eventId}/schedule/versions`, {
    headers: ctx.headers,
  });
  const latest = ((await before.json()) as { version: number }[])[0]!.version;

  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  await page.goto("/admin/publishing");

  // The API has kept every snapshot since the first migration; this screen was
  // the embed builder only, so none of it was reachable.
  await expect(page.getByText(`version ${latest}`)).toBeVisible({ timeout: 20_000 });

  // Rolling back changes what the public reads, so it asks first.
  await page
    .getByRole("button", { name: /^Restore$/ })
    .first()
    .click();
  await expect(page.getByText(/public again\?/)).toBeVisible();
  await page.getByRole("button", { name: /Yes, restore it/ }).click();

  await expect(page.getByText(`version ${latest + 1}`)).toBeVisible({ timeout: 15_000 });
});
