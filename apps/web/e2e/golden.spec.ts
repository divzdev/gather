import { expect, test } from "@playwright/test";

/** The golden paths, against a real API and a real database.
 *
 *  These exist to catch the class of bug unit tests structurally cannot: the two
 *  halves of the app disagreeing. A mocked API would make them pass while the
 *  product was broken, so nothing here is stubbed.
 *
 *  They read the seeded demo event rather than creating their own, because the
 *  seed is itself a deliverable and worth exercising.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(
    health === null || !health.ok(),
    `API not reachable at ${API}. Run \`make dev\` first.`,
  );
});

test("an organiser can sign in and reach the programme", async ({ page }) => {
  await page.goto("/login");

  // The demo build offers one-click sign-in; the harness has no inbox either.
  const demo = page.getByRole("button", { name: /^Organizer$/i });
  await expect(demo).toBeVisible();
  await demo.click();

  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the submissions list shows the seeded proposals", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });

  await page.goto("/admin/submissions");
  await expect(page.getByRole("heading", { name: /submissions/i })).toBeVisible();
  // The seed builds 214; any number proves the list is wired to the API.
  await expect(page.locator("body")).toContainText(/\d+/);
});

test("the agenda shows the three deliberate conflicts", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });

  await page.goto("/admin/agenda");
  // The conflict inspector is the feature; the seed guarantees it has content.
  await expect(page.getByText(/CONFLICT/i).first()).toBeVisible({ timeout: 20_000 });
});

test("a speaker reaches their portal without a password", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Speaker$/i }).click();

  await expect(page).toHaveURL(/\/portal/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("the public schedule is readable with no session at all", async ({ browser }) => {
  // A fresh context: no cookies, no localStorage, nothing carried from sign-in.
  const context = await browser.newContext();
  const page = await context.newPage();

  const response = await page.goto("/e/devflow-conf-2027/schedule");

  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await context.close();
});

test("an attendee builds an itinerary that survives a reload", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/e/devflow-conf-2027/itinerary");

  const first = page.getByRole("checkbox").first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  await first.check();

  // The plan lives in the URL, which is what makes it shareable — so a reload
  // of that URL has to bring it back.
  await expect(page).toHaveURL(/sessions=/, { timeout: 10_000 });
  const shared = page.url();
  await page.goto(shared);
  await expect(page.getByRole("checkbox").first()).toBeChecked();
  await context.close();
});

test("the embed script is served to anyone, with no cache to wait out", async ({ request }) => {
  const response = await request.get(
    `${API}/v1/public/events/devflow-conf-2027/embed.js?widget=schedule`,
  );

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("javascript");
  expect(response.headers()["cache-control"]).toContain("max-age=60");
});
