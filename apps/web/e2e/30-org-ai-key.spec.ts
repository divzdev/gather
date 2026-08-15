import { expect, test } from "@playwright/test";

/** The org key (spec 0003), seam 3: the golden path through real screens.
 *
 *  What E2E can honestly cover: the card is where the nudge says it is, a bad
 *  key fails inline in front of the admin, and the stub answer advertises the
 *  feature to exactly the people who can enable it. The *valid* key path is
 *  proven at the HTTP seam with the provider mocked — this stack talks to the
 *  real provider, and a working Anthropic key is not a fixture a test suite
 *  should own.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

async function signInAsOrganizer(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Organizer|owner/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
}

test("a bad key is refused inline, in the Settings card, with the reason", async ({ page }) => {
  await signInAsOrganizer(page);
  await page.goto("/admin/settings");
  await page.getByRole("button", { name: /^Integrations$/ }).click();

  // The card is present for an owner, and is write-only from birth: a
  // password field with nothing to reveal.
  await expect(page.getByText("AI suggestions — your model API key")).toBeVisible();
  const field = page.getByLabel(/^API key$|Replace the key/);
  await expect(field).toHaveAttribute("type", "password");

  await field.fill("sk-ant-this-key-is-a-typo-123");
  await page.getByRole("button", { name: /Check and save/ }).click();

  // Refused by the provider (or unreachable — same contract: save fails loudly,
  // nothing is stored, the reason is on screen for the person who can fix it).
  // Scoped by text: the Settings screen has other role=alert slots.
  await expect(page.getByRole("alert").filter({ hasText: /refused|Could not reach/ })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/Configured ·/)).toHaveCount(0);
});

test("the stub duplicates answer points an owner at Settings", async ({ page }) => {
  await signInAsOrganizer(page);
  await page.goto("/admin/submissions");
  await page.getByRole("button", { name: /Find duplicates/ }).click();

  // No key on the E2E stack, so the stub answers — and for an owner the label
  // is the feature's own advertisement, linked to where the key goes.
  const dialog = page.getByRole("dialog", { name: /Possible duplicates/ });
  await expect(dialog.getByText(/Sample answer — no model ran/)).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole("link", { name: /^Settings$/ })).toBeVisible();
});
