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

    const rail = page.locator("[data-console-rail]");

    // The mark is a link only while the rail is expanded — collapsed, it is the
    // control that expands it, which is the ordinary sidebar affordance. So the
    // invariant is about where rail links *point*, not about one of them
    // existing in every layout: nothing in the console may send you to the
    // marketing site, and there must always be a way back to the console home.
    const marketing = await rail.locator('a[href="/"]').count();
    expect(marketing, `${path} offers a rail link to the marketing site`).toBe(0);

    const home = await rail.locator('a[href="/admin"]').count();
    expect(home, `${path} offers no way back to the console home`).toBeGreaterThan(0);

    const logo = rail.locator('a[title="Gather home"]');
    if ((await logo.count()) > 0) {
      expect(
        await logo.first().getAttribute("href"),
        `the logo on ${path} leaves the console`,
      ).toBe("/admin");
    }
  }

  // And clicking it really lands on the console, not the landing page. The
  // agenda is not a section-nav route, so the rail is expanded and the mark is
  // the link rather than the expander.
  await page.goto("/admin/agenda");
  await page.locator('a[title="Gather home"]').first().click();
  await page.waitForURL("**/admin", { timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: /good (morning|afternoon|evening)/i }),
  ).toBeVisible({
    timeout: 20_000,
  });
});
