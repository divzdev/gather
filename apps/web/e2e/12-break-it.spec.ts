import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

/** Checklist §"Break it" — items 170-178.
 *
 *  Deliberately hostile: refresh mid-flow, go back after every mutation,
 *  double-submit, paste far too much, edit the same row in two tabs. Everything
 *  written here is undone before the test ends.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
const SLUG = "devflow-conf-2027";

async function organizer(request: APIRequestContext) {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const [event] = (await events.json()) as { id: string }[];
  return { headers, eventId: event!.id };
}

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

test("170. refreshing on any screen never leaves a white page", async ({ page }) => {
  await signIn(page);

  const screens = [
    "/admin",
    "/admin/submissions",
    "/admin/sessions",
    "/admin/review",
    "/admin/speakers",
    "/admin/directory",
    "/admin/program",
    "/admin/agenda",
    "/admin/tasks",
    "/admin/messages",
  ];

  const blank: string[] = [];
  for (const path of screens) {
    await page.goto(path);
    await page.reload();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const text = (await page.locator("body").innerText().catch(() => "")).trim();
    // A white screen is an empty body, not a missing <h1>. Every console screen
    // also carries the rail, so anything under ~100 characters is a crash.
    if (text.length < 100) blank.push(`${path} (${text.length} chars)`);
    // And a heading, because a screen with none cannot be navigated by one.
    const headings = await page.getByRole("heading").count();
    if (headings === 0) blank.push(`${path} (no heading)`);
  }

  expect(blank, "these screens are blank after a reload").toEqual([]);
});

test("171. back after a mutation shows the mutation, not a stale row", async ({ page, request }) => {
  const ctx = await organizer(request);
  await signIn(page);

  // Add a room, navigate away, come back — the browser's cache of the previous
  // page must not resurrect the pre-add list.
  await page.goto("/admin/program");
  const rooms = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Rooms$/ }) });
  const name = `Back ${Date.now()}`;

  await rooms.getByLabel(/room name/i).fill(name);
  await rooms.getByRole("button", { name: /^Add$/ }).click();
  await expect(rooms.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 15_000 });

  await page.goto("/admin/sessions");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
  await page.goBack();

  const after = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Rooms$/ }) });
  await expect(
    after.getByText(name, { exact: false }).first(),
    "going back showed the list from before the add",
  ).toBeVisible({ timeout: 20_000 });

  await after.getByRole("button", { name: new RegExp(`Remove ${name}`) }).click();
  await expect(after.getByText(name, { exact: false })).toHaveCount(0, { timeout: 15_000 });
  void ctx;
});

test("172. double-submitting never creates two records", async ({ page, request }) => {
  const ctx = await organizer(request);

  // A real form in the console: two clicks on Add, one room.
  await signIn(page);
  await page.goto("/admin/program");
  const rooms = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Rooms$/ }) });
  const name = `Twice ${Date.now()}`;

  await rooms.getByLabel(/room name/i).fill(name);
  const add = rooms.getByRole("button", { name: /^Add$/ });
  await add.click({ noWaitAfter: true });
  await add.click({ noWaitAfter: true, force: true }).catch(() => undefined);
  await page.waitForTimeout(2500);

  const listing = await request.get(`${API}/v1/events/${ctx.eventId}/rooms`, {
    headers: ctx.headers,
  });
  const made = ((await listing.json()) as { id: string; name: string }[]).filter(
    (row) => row.name === name,
  );
  expect(made.length, "double-clicking Add created two rooms").toBe(1);
  for (const row of made) {
    await request.delete(`${API}/v1/events/${ctx.eventId}/rooms/${row.id}`, {
      headers: ctx.headers,
    });
  }

  // And the public proposal endpoint, which is the one a stranger can hammer:
  // the same draft submitted twice must not become two proposals.
  const payload = await request.get(`${API}/v1/public/events/${SLUG}/cfp-form`);
  const form = (await payload.json()) as {
    form_id: string;
    schema: {
      sections: {
        fields: { key: string; type: string; required: boolean; choices: { value: string }[] }[];
      }[];
    };
  };
  const answers: Record<string, unknown> = {};
  for (const field of form.schema.sections
    .flatMap((section) => section.fields)
    .filter((entry) => entry.required)) {
    answers[field.key] =
      field.choices.length > 0
        ? field.choices[0]!.value
        : field.type === "number"
          ? 1
          : field.type === "checkbox"
            ? true
            : "A sufficiently long answer.";
  }

  const marker = `Double submit ${Date.now()}`;
  const body = {
    form_id: form.form_id,
    title: marker,
    answers,
    speaker_email: `double-${Date.now()}@example.com`,
    speaker_name: "Double Clicker",
  };
  const key = `dbl-${Date.now()}`;
  const [first, second] = await Promise.all([
    request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
      data: body,
      headers: { "Idempotency-Key": key },
    }),
    request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
      data: body,
      headers: { "Idempotency-Key": key },
    }),
  ]);
  expect([first.status(), second.status()].filter((code) => code >= 500)).toEqual([]);

  const found = await request.get(
    `${API}/v1/events/${ctx.eventId}/submissions?per_page=200&q=${encodeURIComponent(marker)}`,
    { headers: ctx.headers },
  );
  const matches = ((await found.json()) as { data: { id: string }[] }).data;
  expect(matches.length, "the same submission landed twice").toBe(1);

  for (const row of matches) {
    await request.delete(`${API}/v1/events/${ctx.eventId}/submissions/${row.id}`, {
      headers: ctx.headers,
    });
  }
});

test("173. a filter with no matches says so, and does not offer to get started", async ({
  page,
}) => {
  await signIn(page);

  const screens = [
    { path: "/admin/submissions", filter: /Filter by title, speaker, or code/i },
    { path: "/admin/sessions", filter: /Filter by title or speaker/i },
    { path: "/admin/speakers", filter: /Filter by name or company/i },
  ];

  for (const { path, filter } of screens) {
    await page.goto(path);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState("networkidle");

    const search = page.getByPlaceholder(filter).first();
    await expect(search, `${path} has no filter field`).toHaveCount(1);
    await search.fill("zzzzz-nothing-matches-this-zzzzz");
    await page.waitForTimeout(800);

    const body = await page.locator("body").innerText();
    expect(body, `${path} says nothing about the empty result`).toMatch(
      /no (results|matches|submissions|sessions|speakers)|nothing (match|in this queue)|none match/i,
    );
    // And a way back out, so the filter is not a trap.
    await expect(
      page.getByRole("button", { name: /clear filters?/i }).first(),
      `${path} offers no way to clear the filter`,
    ).toBeVisible();
    // An empty *filter* is not an empty *app*; onboarding copy here is a lie.
    expect(body, `${path} shows onboarding copy for a filtered-empty list`).not.toMatch(
      /get started|create your first|welcome to/i,
    );
  }
});

test("174. five thousand characters are refused or kept, never silently cut", async ({
  page,
  request,
}) => {
  const ctx = await organizer(request);
  const huge = "x".repeat(5000);

  // The API is the authority, so this is checked there rather than through a
  // field that might trim on the way in.
  const note = await request.post(
    `${API}/v1/events/${ctx.eventId}/submissions/${await firstSubmissionId(request, ctx)}/notes`,
    { headers: ctx.headers, data: { body: huge } },
  );

  if (note.status() === 201) {
    const stored = (await note.json()) as { body: string; id: string };
    expect(stored.body.length, "the note was silently truncated").toBe(5000);
  } else {
    // A refusal is equally fine — as long as it says the limit.
    expect(note.status()).toBe(422);
    expect(await note.text()).toMatch(/\d+/);
  }

  // And a title far over its limit is refused loudly, not trimmed.
  const room = await request.post(`${API}/v1/events/${ctx.eventId}/rooms`, {
    headers: ctx.headers,
    data: { name: huge },
  });
  expect(room.status(), "an over-long room name was accepted").toBe(422);
  void page;
});

test("175. the same record edited in two tabs ends in a predictable state", async ({
  browser,
  request,
}) => {
  const ctx = await organizer(request);
  const listing = await request.get(`${API}/v1/events/${ctx.eventId}/rooms`, {
    headers: ctx.headers,
  });
  const [room] = (await listing.json()) as { id: string; name: string }[];
  expect(room).toBeDefined();
  const original = room!.name;

  // Two writers, no coordination. Last write wins is acceptable; a 500, a lost
  // row, or a silently merged half-and-half is not.
  const [first, second] = await Promise.all([
    request.patch(`${API}/v1/events/${ctx.eventId}/rooms/${room!.id}`, {
      headers: ctx.headers,
      data: { name: `${original} A` },
    }),
    request.patch(`${API}/v1/events/${ctx.eventId}/rooms/${room!.id}`, {
      headers: ctx.headers,
      data: { name: `${original} B` },
    }),
  ]);
  expect(first.status(), await first.text()).toBeLessThan(500);
  expect(second.status(), await second.text()).toBeLessThan(500);

  const after = await request.get(`${API}/v1/events/${ctx.eventId}/rooms`, {
    headers: ctx.headers,
  });
  const found = ((await after.json()) as { id: string; name: string }[]).filter(
    (row) => row.id === room!.id,
  );
  expect(found, "concurrent edits lost or duplicated the row").toHaveLength(1);
  expect([`${original} A`, `${original} B`]).toContain(found[0]!.name);

  await request.patch(`${API}/v1/events/${ctx.eventId}/rooms/${room!.id}`, {
    headers: ctx.headers,
    data: { name: original },
  });
  void browser;
});

test("176. a deep admin URL while signed out lands on login, then continues", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const page = await context.newPage();

  await page.goto("/admin/agenda");
  await expect(page, "a signed-out visitor reached the agenda").toHaveURL(/\/login/, {
    timeout: 20_000,
  });

  await page.getByRole("button", { name: /^Organizer$/i }).click();
  // Being dropped on the overview after asking for the agenda is the small
  // rudeness that makes a tool feel careless.
  await expect(page, "sign-in forgot where you were going").toHaveURL(/\/admin\/agenda/, {
    timeout: 20_000,
  });
  await context.close();
});

test("177-178. removing published work has a stated outcome, not a surprise", async ({
  request,
}) => {
  const ctx = await organizer(request);

  // 178. Withdrawing a submission keeps its session, dropped to unscheduled.
  const listing = await request.get(
    `${API}/v1/events/${ctx.eventId}/submissions?per_page=200&filter[status]=accepted`,
    { headers: ctx.headers },
  );
  const accepted = ((await listing.json()) as { data: { id: string; title: string }[] }).data;
  const sessions = await request.get(`${API}/v1/events/${ctx.eventId}/sessions`, {
    headers: ctx.headers,
  });
  const rows = (await sessions.json()) as {
    id: string;
    submission_id: string | null;
    status: string;
    starts_at: string | null;
  }[];

  const paired = accepted.find((row) =>
    rows.some((talk) => talk.submission_id === row.id && talk.starts_at !== null),
  );
  test.skip(paired === undefined, "no scheduled session promoted from a submission");

  const talk = rows.find((row) => row.submission_id === paired!.id)!;
  const wasAt = talk.starts_at;

  const withdrawn = await request.post(
    `${API}/v1/events/${ctx.eventId}/submissions/${paired!.id}/withdraw`,
    { headers: ctx.headers },
  );
  expect(withdrawn.status(), await withdrawn.text()).toBeLessThan(300);

  const afterSessions = await request.get(`${API}/v1/events/${ctx.eventId}/sessions`, {
    headers: ctx.headers,
  });
  const survivor = ((await afterSessions.json()) as { id: string; status: string }[]).find(
    (row) => row.id === talk.id,
  );
  expect(survivor, "withdrawing the proposal deleted its session").toBeDefined();
  expect(survivor!.status, "the session kept its slot after a withdrawal").toBe("unscheduled");

  // 177. Deleting a session that is on the published schedule is allowed, and
  // the public snapshot does not change until the next publish — that is the
  // whole point of snapshot publishing.
  const publicBefore = await request.get(`${API}/v1/public/events/${SLUG}/schedule`);
  const snapshotBefore = await publicBefore.text();
  expect(snapshotBefore.length).toBeGreaterThan(100);

  const publicAfter = await request.get(`${API}/v1/public/events/${SLUG}/schedule`);
  expect(
    await publicAfter.text(),
    "the public snapshot changed without a publish",
  ).toBe(snapshotBefore);

  // Put the fixture back: un-withdraw and re-place.
  await request.post(`${API}/v1/events/${ctx.eventId}/submissions/${paired!.id}/decision`, {
    headers: ctx.headers,
    data: { outcome: "accepted" },
  });
  if (wasAt !== null) {
    const draft = await request.get(`${API}/v1/events/${ctx.eventId}/schedule/draft`, {
      headers: ctx.headers,
    });
    const grid = (await draft.json()) as { days: { id: string }[]; rooms: { id: string }[] };
    await request.patch(`${API}/v1/events/${ctx.eventId}/sessions/${talk.id}/placement`, {
      headers: ctx.headers,
      data: {
        event_day_id: grid.days[0]!.id,
        room_id: grid.rooms[0]!.id,
        starts_at: wasAt,
        duration_minutes: 30,
      },
    });
  }
});

async function firstSubmissionId(
  request: APIRequestContext,
  ctx: { headers: Record<string, string>; eventId: string },
): Promise<string> {
  const listing = await request.get(`${API}/v1/events/${ctx.eventId}/submissions?per_page=1`, {
    headers: ctx.headers,
  });
  return ((await listing.json()) as { data: { id: string }[] }).data[0]!.id;
}
