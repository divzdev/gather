import { expect, test } from "@playwright/test";

/** The console does not sign-post you out of itself.
 *
 *  The rail's mark is converted from a prototype that links it to the marketing
 *  landing page — correct on a public page, wrong once you are signed in, where
 *  clicking your own product logo should go to the app's home.
 */
test("the rail's logo goes to the console home, not the marketing site", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });

  for (const path of ["/admin/submissions", "/admin/agenda", "/admin/settings"]) {
    await page.goto(path);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

    const mark = page.locator('nav a[href], a[title="Gather home"]').first();
    const href = await page.locator('a[title="Gather home"]').first().getAttribute("href");
    expect(href, `the logo on ${path} leaves the console`).toBe("/admin");
    void mark;
  }

  // And clicking it really lands on the console, not the landing page.
  await page.goto("/admin/agenda");
  await page.locator('a[title="Gather home"]').first().click();
  await page.waitForURL("**/admin", { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /good (morning|afternoon|evening)/i })).toBeVisible({
    timeout: 20_000,
  });
});
