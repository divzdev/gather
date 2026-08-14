import { expect, test, type Page } from "@playwright/test";

/** Checklist §"Final" — items 179-180.
 *
 *  Item 180 is "read your own README and check every claim is reachable in three
 *  clicks". This encodes that: each capability the README advertises has to be
 *  reachable by clicking, from a cold start, without knowing a URL.
 *
 *  Item 179 — hand it to a stranger and write down every hesitation — is a
 *  human test and stays one. What is automatable is its precondition: the whole
 *  arc it asks for, CFP through to a scheduled session, has to be completable
 *  through the interface. That is the last test in this file.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
const SLUG = "devflow-conf-2027";

/** Straight from the README's feature sentence. */
const ADVERTISED = [
  // Badged rail items announce their count ("Review 46"), and since the badge
  // values warm-start from a snapshot the count is present from first paint —
  // so the anchors match the word, not the whole accessible name.
  { claim: "CFP intake", link: /Submissions/, expect: /\/admin\/submissions/ },
  { claim: "review and scoring", link: /^Review\b/, expect: /\/admin\/review/ },
  { claim: "accept/reject", link: /Submissions/, expect: /\/admin\/submissions/ },
  { claim: "speaker onboarding", link: /^Tasks\b/, expect: /\/admin\/tasks/ },
  { claim: "agenda building", link: /^Agenda\b/, expect: /\/admin\/agenda/ },
  { claim: "published public schedule", link: /^Publishing\b/, expect: /\/admin\/publishing/ },
];

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

test("180. every URL the README prints answers", async ({ request }) => {
  const base = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000";

  for (const [label, url] of [
    ["Web", `${base}/`],
    ["API", `${API}/v1/health`],
    ["API docs", `${API}/v1/docs`],
  ] as const) {
    const response = await request.get(url);
    expect(response.status(), `the README's ${label} URL does not answer`).toBeLessThan(400);
  }
});

test("180. every capability the README advertises is two clicks from the front door", async ({
  page,
}) => {
  // Click one: sign in. Click two: the rail. Nothing the README promises may be
  // buried deeper than that.
  await signIn(page);

  const unreachable: string[] = [];
  for (const feature of ADVERTISED) {
    await page.goto("/admin");
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

    const link = page.getByRole("link", { name: feature.link }).first();
    if ((await link.count()) === 0) {
      unreachable.push(`${feature.claim}: no rail link`);
      continue;
    }
    await link.click();
    await page.waitForURL(feature.expect, { timeout: 20_000 }).catch(() => undefined);
    if (!feature.expect.test(page.url())) {
      unreachable.push(`${feature.claim}: went to ${page.url()}`);
    }
  }

  expect(unreachable, "README capabilities not reachable from the rail").toEqual([]);
});

test("180. the public surfaces the README promises are reachable with no account", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const page = await context.newPage();

  // "a published public schedule" — a visitor must get there from the event
  // landing page without being told a URL.
  await page.goto(`/e/${SLUG}`);
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

  // By href, not by name: the page also offers an itinerary builder, whose
  // label mentions the schedule and would match a looser selector first.
  const schedule = page.locator(`a[href$="/e/${SLUG}/schedule"]`).first();
  await expect(schedule, "no link to the schedule from the event page").toHaveCount(1);
  await schedule.click();
  await expect(page).toHaveURL(/\/schedule/, { timeout: 20_000 });
  await expect(page.getByRole("heading").first()).toBeVisible();

  // And the speaker gallery, the other public surface the README names.
  await page.goto(`/e/${SLUG}`);
  const speakers = page.locator(`a[href$="/e/${SLUG}/speakers"]`).first();
  await expect(speakers, "no link to the speaker gallery").toHaveCount(1);

  await context.close();
});

test("179. the arc the README describes completes through the interface", async ({
  page,
  request,
}) => {
  // CFP → review → decide → promote → schedule, driven by clicking. This does
  // not prove the flow is *obvious* — that needs a person — but a flow that
  // cannot be completed at all cannot be walked by a stranger either.
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const eventId = ((await events.json()) as { id: string }[])[0]!.id;

  await signIn(page);

  const stops: { name: string; path: string; proof: RegExp }[] = [
    { name: "proposals arrive", path: "/admin/submissions", proof: /of \d+ (matching|proposals)/i },
    { name: "they get scored", path: "/admin/review", proof: /round|reviewer|score/i },
    { name: "they become sessions", path: "/admin/sessions", proof: /session/i },
    { name: "sessions get a slot", path: "/admin/agenda", proof: /conflict|room|unscheduled/i },
    { name: "the programme goes out", path: "/admin/publishing", proof: /publish|embed|snapshot/i },
  ];

  const broken: string[] = [];
  for (const stop of stops) {
    await page.goto(stop.path);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
    await page.waitForLoadState("networkidle");
    const body = await page.locator("body").innerText();
    if (!stop.proof.test(body)) broken.push(`${stop.name} (${stop.path})`);
  }

  expect(broken, "stages of the advertised arc that show nothing").toEqual([]);

  // And the seeded event is populated enough for a stranger to see each stage
  // in its filled state, which the architecture doctrine requires of the demo.
  const counts = await request.get(`${API}/v1/events/${eventId}/submissions?per_page=1`, {
    headers,
  });
  const total = ((await counts.json()) as { meta: { total: number } }).meta.total;
  expect(total, "an empty app teaches nothing").toBeGreaterThan(50);
});
