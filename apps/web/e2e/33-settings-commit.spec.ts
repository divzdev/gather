import { expect, test } from "@playwright/test";

/** Settings has no save button by design — fields commit themselves 700ms after
 *  the typing stops. That debounce lost writes two ways, and both are pinned
 *  here because neither is visible without a browser: nothing flushed the timer
 *  when you left the screen, and one timer served every field, so the second
 *  edit inside the window cancelled the first.
 *
 *  Found by the SessionBoard eval agent, which spent the last ten turns of
 *  CFP-S4 filling the CFP close date, leaving, and coming back to check —
 *  exactly what a person does when a control gives them nothing back. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
const COMMIT_DELAY_MS = 700;

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

async function openSettings(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  await page.goto("/admin/settings");
  await expect(page.getByText(/Editing /)).toBeVisible({ timeout: 20_000 });
}

test("leaving the screen commits the edit rather than discarding it", async ({ page }) => {
  await openSettings(page);

  const location = page.getByLabel(/Location/i).first();
  await expect(location).toBeVisible({ timeout: 15_000 });
  const value = `Moscone West, Hall ${Date.now() % 10_000}`;

  const saved = page.waitForResponse(
    (r) => r.request().method() === "PATCH" && /\/events\//.test(r.url()),
    { timeout: 15_000 },
  );

  await location.fill(value);
  // Leave immediately — well inside the debounce, which is the whole point.
  // Before the flush this produced no request at all: no save, no error, and
  // the field still showing what you had typed.
  await page.goto("/admin");

  const response = await saved;
  expect(response.status(), "leaving the screen dropped the edit").toBeLessThan(400);

  await page.goto("/admin/settings");
  await expect(page.getByLabel(/Location/i).first()).toHaveValue(value, { timeout: 15_000 });
});

test("a second field inside the window does not cancel the first", async ({ page }) => {
  await openSettings(page);

  const location = page.getByLabel(/Location/i).first();
  const stamp = Date.now() % 10_000;
  const where = `Hall ${stamp}`;

  const bodies: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && /\/events\//.test(request.url())) {
      try {
        bodies.push(JSON.parse(request.postData() ?? "{}"));
      } catch {
        /* a body we cannot read is a body we cannot assert on */
      }
    }
  });

  await location.fill(where);
  const description = page.getByLabel(/Description/i).first();
  if (await description.isVisible().catch(() => false)) {
    await description.fill(`Set at ${stamp}`);
    await page.waitForTimeout(COMMIT_DELAY_MS * 3);

    // Coalesced into one PATCH carrying both, not one PATCH that forgot the
    // first field.
    const carried = bodies.find((body) => "location" in body && "description" in body);
    expect(
      carried,
      `no PATCH carried both fields; the second edit cancelled the first. Sent: ${JSON.stringify(bodies)}`,
    ).toBeDefined();
  }

  await page.goto("/admin/settings");
  await expect(page.getByLabel(/Location/i).first()).toHaveValue(where, { timeout: 15_000 });
});
