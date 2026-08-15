import { expect, test } from "@playwright/test";

/** Organisation settings (spec 0004), seam 2: the golden path through real
 *  screens.
 *
 *  What this proves that the HTTP tests cannot: the two tiers are two groups a
 *  person can see and tell apart, someone added to the organisation shows up on
 *  an event's Team list marked and uneditable, that marker leads to the screen
 *  that does own the decision, and removal states the consequence before it
 *  happens. The guard matrix itself is proven at the HTTP seam, where every
 *  refusal has a test.
 *
 *  Cleanup, stated precisely: the person added is removed again through the UI,
 *  the rename is put back, and `afterAll` removes the membership over the API in
 *  case a test died before that point. The `users` row survives every run —
 *  removal from an organisation deliberately does not delete an account, and
 *  there is no endpoint that does. Each run stamps a fresh address, so those
 *  rows accumulate in a dev database and belong to nothing.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

// `example.com` on purpose, twice over: `EmailStr` accepts it where a
// special-use TLD like `.test` is rejected outright, and `mail.py`'s reserved
// -domain guard refuses it before SES, so this address cannot reach an inbox
// even if the suite is ever pointed at a live box. The run stamp keeps a re-run
// from meeting its own leftovers if a previous run died mid-way.
const STAMP = `${Date.now()}`.slice(-6);
const PERSON = { name: `Org Tester ${STAMP}`, email: `org-tester-${STAMP}@example.com` };

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

/** Best-effort teardown over the API, so a run that fails partway through still
 *  leaves the organisation as it found it. Silent on every failure: this is
 *  cleanup, and turning it into a second source of red would hide the first. */
test.afterAll(async ({ request }) => {
  try {
    const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
    if (!login.ok()) return;
    const { access_token: token } = (await login.json()) as { access_token?: string };
    if (token === undefined) return;
    const headers = { authorization: `Bearer ${token}` };
    const events = await request.get(`${API}/v1/events`, { headers });
    const [event] = (await events.json()) as { org_id: string }[];
    if (event === undefined) return;
    const members = await request.get(`${API}/v1/orgs/${event.org_id}/members`, { headers });
    const leftover = ((await members.json()) as { user_id: string; email: string }[]).find(
      (member) => member.email === PERSON.email,
    );
    if (leftover !== undefined) {
      await request.delete(`${API}/v1/orgs/${event.org_id}/members/${leftover.user_id}`, {
        headers,
      });
    }
  } catch {
    // Nothing to do: the stack is already gone or never came up.
  }
});

async function openSettings(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Organizer|owner/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  await page.goto("/admin/settings");
}

test("Settings separates the event's settings from the organisation's", async ({ page }) => {
  await openSettings(page);

  await expect(page.getByText("EVENT SETTINGS")).toBeVisible();
  await expect(page.getByText("ORGANISATION", { exact: true })).toBeVisible();

  // The organisation panel names the workspace and says what it covers.
  await page.getByRole("button", { name: /^Organisation$/ }).click();
  await expect(page.getByRole("heading", { name: "Organisation" })).toBeVisible();
  await expect(page.getByLabel("Organisation name")).toBeVisible();
  await expect(page.getByText(/event(s)?$/).first()).toBeVisible();
});

test("someone added to the organisation appears on the event's Team, marked and uneditable", async ({
  page,
}) => {
  await openSettings(page);
  await page.getByRole("button", { name: /^People$/ }).click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();

  await page.getByLabel("Full name").fill(PERSON.name);
  await page.getByLabel("Email", { exact: true }).fill(PERSON.email);
  await page.getByLabel("Role", { exact: true }).selectOption("coordinator");
  await page.getByRole("button", { name: /Add & send link/ }).click();

  // The row itself, not the toast: "works on every event" also appears in this
  // panel's own subtitle, so asserting the message let a failed add read as a
  // pass the first time this was written.
  await expect(page.getByText(PERSON.email, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel(`Role for ${PERSON.name}`)).toHaveValue("coordinator");

  // The event's own Team list still shows them — that list answers "who works
  // on this event", and they genuinely do — but marked, with no controls.
  await page.getByRole("button", { name: /^Team$/ }).click();
  await expect(page.getByText(PERSON.email, { exact: true })).toBeVisible({ timeout: 20_000 });
  const marker = page.getByRole("button", { name: new RegExp(`^${PERSON.name} works on every`) });
  await expect(marker).toBeVisible();
  await expect(page.getByLabel(`Role for ${PERSON.name}`)).toHaveCount(0);

  // And the other half of the sentence: now that the list holds both tiers, the
  // event-scoped rows say so too, which is the on-screen answer to "why can't I
  // open the Directory?" for someone who was only invited to this event.
  await expect(page.getByText("This event", { exact: true }).first()).toBeVisible();

  // And the marker leads to the screen that does own the decision.
  await marker.click();
  await expect(page.getByRole("heading", { name: "People" })).toBeVisible();
  await expect(page.getByLabel(`Role for ${PERSON.name}`)).toBeVisible();
});

test("removing from the organisation says how many events they lose, first", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: /^People$/ }).click();
  await expect(page.getByText(PERSON.email, { exact: true })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: `Remove ${PERSON.name}` }).click();

  // The consequence is off-screen, so it is stated before it happens — with a
  // real count, and with what removal does *not* do.
  await expect(
    page.getByText(new RegExp(`${PERSON.name} loses access to \\d+ events?\\.`)),
  ).toBeVisible();
  await expect(page.getByText(/added to individually keeps them/)).toBeVisible();

  await page.getByRole("button", { name: /Remove from organisation/ }).click();
  await expect(page.getByText(/no longer works on every event/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(PERSON.email, { exact: true })).toHaveCount(0);
});

test("the owner can rename the workspace, and it sticks", async ({ page }) => {
  await openSettings(page);
  await page.getByRole("button", { name: /^Organisation$/ }).click();

  const field = page.getByLabel("Organisation name");
  await expect(field).toBeVisible({ timeout: 20_000 });
  const original = await field.inputValue();
  expect(original.length).toBeGreaterThan(0);

  const renamed = `${original} ${STAMP}`;
  await field.fill(renamed);
  await page.getByRole("button", { name: /Save name/ }).click();
  await expect(page.getByText(new RegExp(`now called ${renamed}`))).toBeVisible({
    timeout: 20_000,
  });

  await page.reload();
  await page.getByRole("button", { name: /^Organisation$/ }).click();
  await expect(page.getByLabel("Organisation name")).toHaveValue(renamed, { timeout: 20_000 });

  // Put it back, so the next run starts where this one did.
  await page.getByLabel("Organisation name").fill(original);
  await page.getByRole("button", { name: /Save name/ }).click();
  await expect(page.getByText(new RegExp(`now called ${original}`))).toBeVisible({
    timeout: 20_000,
  });
});
