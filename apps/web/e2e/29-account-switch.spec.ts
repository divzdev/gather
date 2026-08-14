import { expect, test } from "@playwright/test";

/** Switching accounts without closing the tab.
 *
 *  Signing in stores a token and used to navigate with `router.push`, which
 *  keeps the React tree and the TanStack Query cache alive across the switch.
 *  Both are keyed to who you *were*, and `["me"]` carries a five-minute
 *  `staleTime`, so the console answered from a memory of the previous account
 *  while holding the new account's token:
 *
 *    owner    then reviewer  -> the reviewer was shown the owner's console
 *    reviewer then organizer -> a real organizer was bounced to /review by
 *                               RequireStaff reading a stale `role`
 *
 *  Both directions are asserted, because fixing one by hand and calling it done
 *  is exactly how the other survived. The tab is never reloaded between the two
 *  sign-ins on purpose — a fresh document is what used to hide this.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

type Page = import("@playwright/test").Page;

async function demoSignIn(page: Page, who: "Organizer" | "Reviewer"): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`^${who}$`, "i") }).click();
}

/** Sign out through the header menu, the way a person does it. */
async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("button", { name: /^Sign out$/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
}

test("a reviewer signing in after an owner does not inherit the owner's console", async ({
  page,
}) => {
  await page.goto("/login");
  await demoSignIn(page, "Organizer");
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });

  await signOut(page);
  await demoSignIn(page, "Reviewer");

  // The reviewer owns /review and nothing under /admin. Landing on /admin means
  // the stale role let them through.
  await expect(page).toHaveURL(/\/review/, { timeout: 20_000 });
  await expect(page).not.toHaveURL(/\/admin/);
});

test("an organizer signing in after a reviewer reaches the console, not /review", async ({
  page,
}) => {
  await page.goto("/login");
  await demoSignIn(page, "Reviewer");
  await expect(page).toHaveURL(/\/review/, { timeout: 20_000 });

  await signOut(page);
  await demoSignIn(page, "Organizer");

  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });

  // The bug bounced every /admin link back to /review, so the destination alone
  // is not enough — press one and confirm it stays pressed.
  await page
    .getByRole("link", { name: /^Submissions/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/admin\/submissions/, { timeout: 20_000 });
});
