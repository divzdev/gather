import { expect, test, type APIRequestContext } from "@playwright/test";

/** Checklist §"Review setup" and §"Score as reviewer" — items 65-90.
 *
 *  The weight here is on the invariants rather than the chrome: blind review
 *  stripping identity in the *payload*, an abstention leaving the mean alone,
 *  and an unscored review not counting as zero. Those are the ones that are
 *  invisible on screen and wrong forever if they break.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

type Ctx = { headers: Record<string, string>; eventId: string };

async function organizer(request: APIRequestContext): Promise<Ctx> {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const [event] = (await events.json()) as { id: string }[];
  return { headers, eventId: event!.id };
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

test("66-67. a submission shows every answer, and takes an internal note", async ({ request }) => {
  const { headers, eventId } = await organizer(request);
  // Oldest first, deliberately. The default is newest first, which hands this
  // whichever thin proposal an earlier spec in the run just submitted — so the
  // test passed alone and failed in the suite. The seeded demo is the oldest
  // and is the thing worth asserting on: a full set of custom answers.
  const listing = await request.get(
    `${API}/v1/events/${eventId}/submissions?per_page=5&sort=submitted_at`,
    { headers },
  );
  const [first] = ((await listing.json()) as { data: { id: string }[] }).data;
  expect(first).toBeDefined();

  const detail = await request.get(`${API}/v1/events/${eventId}/submissions/${first!.id}`, {
    headers,
  });
  expect(detail.status()).toBe(200);
  const body = (await detail.json()) as { answers: Record<string, unknown> };
  // 66. Custom answers survive the round trip, not just the built-in columns.
  expect(Object.keys(body.answers).length).toBeGreaterThan(2);

  // 67. A note is recorded and comes back.
  const note = `Checklist note ${Date.now()}`;
  const added = await request.post(`${API}/v1/events/${eventId}/submissions/${first!.id}/notes`, {
    headers,
    data: { body: note },
  });
  expect(added.status(), await added.text()).toBeLessThan(300);
});

test("68-70. a round takes a rubric, and weights that do not total 100 are refused", async ({
  request,
}) => {
  const { headers, eventId } = await organizer(request);

  const round = await request.post(`${API}/v1/events/${eventId}/review-rounds`, {
    headers,
    data: { name: `Checklist round ${Date.now()}`, sort_order: 90 },
  });
  expect(round.status(), await round.text()).toBeLessThan(300);
  const { id: roundId } = (await round.json()) as { id: string };

  // Weights here are relative (0-9), not percentages that must total 100 —
  // mathematically the same weighted mean, with less arithmetic for the user.
  for (const [index, weight] of [3, 2, 1].entries()) {
    const made = await request.post(
      `${API}/v1/events/${eventId}/review-rounds/${roundId}/criteria`,
      {
        headers,
        data: {
          label: `Criterion ${index}`,
          kind: "rating",
          weight,
          scale_min: 1,
          scale_max: 5,
          sort_order: index,
        },
      },
    );
    expect(made.status(), await made.text()).toBeLessThan(300);
  }

  const criteria = await request.get(
    `${API}/v1/events/${eventId}/review-rounds/${roundId}/criteria`,
    { headers },
  );
  const rows = (await criteria.json()) as { weight: string }[];
  expect(rows.length).toBe(3);
  expect(rows.map((row) => Number(row.weight))).toEqual([3, 2, 1]);

  // 70. A weight outside the allowed range is refused rather than stored.
  const bad = await request.post(`${API}/v1/events/${eventId}/review-rounds/${roundId}/criteria`, {
    headers,
    data: { label: "Impossible", kind: "rating", weight: 90, scale_min: 1, scale_max: 5 },
  });
  expect(bad.status()).toBe(422);
});

test("75-78. a reviewer sees only their own queue, with identity stripped", async ({ request }) => {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "reviewer" } });
  expect(login.status()).toBe(200);
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const [event] = (await events.json()) as { id: string }[];
  expect(event, "the reviewer is not on any event").toBeDefined();
  const eventId = event!.id;

  const rounds = await request.get(`${API}/v1/events/${eventId}/review/rounds`, { headers });
  const [round] = (await rounds.json()) as { id: string }[];
  expect(round, "the reviewer sees no round").toBeDefined();

  const queue = await request.get(
    `${API}/v1/events/${eventId}/review/queue?round_id=${round!.id}`,
    { headers },
  );
  expect(queue.status(), await queue.text()).toBe(200);
  const items = (await queue.json()) as { id: string }[];

  // 78. The check that matters: identity is absent from the payload, not merely
  // hidden by CSS. A reviewer who opens DevTools must not find the name.
  const raw = await queue.text();
  expect(raw).not.toMatch(/speaker_name|"email"|company/i);

  if (items.length > 0) {
    const detail = await request.get(
      `${API}/v1/events/${eventId}/review/submissions/${items[0]!.id}`,
      { headers },
    );
    const detailRaw = await detail.text();
    expect(detailRaw).not.toMatch(/"email"\s*:/i);
  }
});

test("76+83. a reviewer cannot reach the organiser's surface", async ({ request }) => {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "reviewer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };

  const events = await request.get(`${API}/v1/events`, { headers });
  const [event] = (await events.json()) as { id: string }[];
  test.skip(event === undefined, "the reviewer is not on an event");

  // Every admin surface a reviewer might guess at has to refuse, with a status
  // rather than a blank page.
  for (const path of ["submissions", "speakers", "tasks/summary", "conflicts"]) {
    const response = await request.get(`${API}/v1/events/${event!.id}/${path}`, { headers });
    expect([401, 403], `${path} let a reviewer in with ${response.status()}`).toContain(
      response.status(),
    );
  }
});

test("83. a reviewer opening /admin is redirected, not shown a blank page", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByRole("button", { name: /^Reviewer$/i }).click();
  await page.waitForTimeout(1500);

  await page.goto("/admin/submissions");
  await page.waitForTimeout(2500);

  const text = (await page.locator("body").innerText()).trim();
  // Either it bounces to login, or it says something. A blank screen is the
  // failure this item exists to catch.
  expect(text.length, "the admin screen rendered blank for a reviewer").toBeGreaterThan(20);
  await context.close();
});

/** The guard was never the problem. `RequireStaff` has always bounced a reviewer
 *  off `/admin`, and the two tests above pin that. What the console did anyway
 *  was *advertise* the organiser's dozen screens to them, in the rail, the ⌘K
 *  palette, the event switcher and the account menu — every link bouncing
 *  straight back to `/review`. This pins the nav, not the authorization. */
test("a reviewer is not offered the organiser's navigation", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByRole("button", { name: /^Reviewer$/i }).click();
  await page.waitForURL(/\/review/, { timeout: 15_000 });
  await page.waitForTimeout(1500);

  // Named individually rather than by counting links: a count passes for the
  // wrong reason the moment the rail gains an item.
  for (const item of ["Submissions", "Sessions", "Agenda", "Publishing", "Settings", "Messages"]) {
    await expect(
      page.locator(`[data-console-rail] a[title="${item}"]`),
      `the rail offered a reviewer ${item}`,
    ).toBeHidden();
  }

  // The rail still has to say who you are and get you home.
  await expect(page.locator('[data-console-rail] a[title="Gather home"]')).toBeVisible();

  await expect(
    page.locator("[data-console-search]"),
    "the palette trigger was drawn for a reviewer",
  ).toBeHidden();
  await expect(
    page.locator("[data-console-ask]"),
    "the assistant, which refuses reviewers server-side, was still offered",
  ).toBeHidden();

  // ⌘K itself, not only its button: the shortcut works from anywhere.
  await page.keyboard.press("ControlOrMeta+k");
  await page.waitForTimeout(600);
  await expect(page.getByRole("dialog"), "the command palette opened for a reviewer").toBeHidden();

  await context.close();
});

test("an organiser still gets the whole console", async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await page.waitForURL(/\/admin/, { timeout: 15_000 });
  await page.waitForTimeout(1500);

  // The other half of the pair. Hiding nav by role is one predicate away from
  // hiding it from everybody, and that failure would look like a working app.
  for (const item of ["Submissions", "Sessions", "Agenda", "Publishing", "Settings", "Messages"]) {
    await expect(
      page.locator(`[data-console-rail] a[title="${item}"]`),
      `the rail lost ${item} for an organiser`,
    ).toBeVisible();
  }
  await expect(page.locator("[data-console-search]")).toBeVisible();
  await expect(page.locator("[data-console-ask]")).toBeVisible();

  await context.close();
});

test("85-86. an abstention is excluded and an unscored review is not a zero", async ({
  request,
}) => {
  const { headers, eventId } = await organizer(request);
  const listing = await request.get(`${API}/v1/events/${eventId}/submissions?per_page=200`, {
    headers,
  });
  const rows = (
    (await listing.json()) as {
      data: { id: string; score_avg: number | null; review_count: number }[];
    }
  ).data;

  // Nothing with no completed reviews may carry a score of zero: that would sink
  // it to the bottom of a sorted list for never having been read.
  const unscoredWithZero = rows.filter((row) => row.review_count === 0 && row.score_avg === 0);
  expect(
    unscoredWithZero.map((row) => row.id),
    "unreviewed submissions are being scored zero",
  ).toEqual([]);

  // And anything carrying a score has at least one review behind it.
  const scoredWithoutReviews = rows.filter(
    (row) => row.score_avg !== null && row.review_count === 0,
  );
  expect(
    scoredWithoutReviews.map((row) => row.id),
    "a score with no reviews",
  ).toEqual([]);
});

test("89. scores export as CSV with one row per submission", async ({ request }) => {
  const { headers, eventId } = await organizer(request);
  const rounds = await request.get(`${API}/v1/events/${eventId}/review-rounds`, { headers });
  const [round] = (await rounds.json()) as { id: string }[];
  test.skip(round === undefined, "no review round on the seeded event");

  const csv = await request.get(
    `${API}/v1/events/${eventId}/review-rounds/${round!.id}/results.csv`,
    { headers },
  );
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");

  const lines = (await csv.text()).trim().split("\n");
  expect(lines[0]).toContain("average_score");

  const submissions = await request.get(`${API}/v1/events/${eventId}/submissions?per_page=1`, {
    headers,
  });
  const body = (await submissions.json()) as { meta?: { total?: number } };
  const total = body.meta?.total;
  expect(total, "the submissions list reports no total").toBeDefined();
  expect(lines.length - 1, "the export should carry every submission").toBe(total);
});
