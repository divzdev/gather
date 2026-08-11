import { expect, test } from "@playwright/test";

/** Text in the console that reads like data must actually be data.
 *
 *  These screens are converted from design prototypes, so every screen arrives
 *  with the mock's numbers and URLs baked into its markup. They render perfectly
 *  and are wrong for every real user, which makes them invisible in review and
 *  obvious in a demo.
 *
 *  Part one: the console's links to the public site must use the event's own slug.
 *
 *  Four screens shipped their prototype's literal `/e/devflow-2027`. The seeded
 *  demo event's slug is `devflow-conf-2027`, so those links 404 even here — and
 *  for any other organisation they would point at somebody else's event. Text
 *  that reads like data is the failure mode: it looks right in a screenshot and
 *  is wrong for every real user.
 */

const LINKS = [
  { route: "/admin", label: /view the live form/i, suffix: "/cfp" },
  { route: "/admin/publishing", label: /view public page/i, suffix: "" },
] as const;

test("public links carry the event's real slug, not the prototype's", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });

  for (const { route, label, suffix } of LINKS) {
    await page.goto(route);
    const link = page.getByRole("link", { name: label }).first();
    await expect(link, `${route} has no public link`).toBeVisible({ timeout: 20_000 });

    // "/admin" is the deliberate placeholder while the event query is in flight.
    await expect
      .poll(async () => link.getAttribute("href"), { timeout: 15_000 })
      .not.toBe("/admin");

    const href = (await link.getAttribute("href")) ?? "";
    expect(href, `${route} still points at the prototype's slug`).not.toContain("devflow-2027");
    expect(href, `${route} is not an /e/<slug>${suffix} link`).toMatch(
      new RegExp(`^/e/[a-z0-9-]+${suffix}$`),
    );

    // And it actually resolves — a slug that 404s is the bug this guards.
    const response = await page.request.get(href);
    expect(response.status(), `${href} does not resolve`).toBeLessThan(400);
  }
});

/** The strip under the header repeats the programme's numbers on every screen.
 *  Six of them shipped "OVERDUE TASKS 12" and "3 CONFLICTS" as literal text, so
 *  the strip contradicted itself as you navigated. Screens carry different
 *  subsets of the labels, so this compares each label wherever it appears. */
test("the programme strip never disagrees with itself", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });

  const LABELS = [
    ["overdue", /OVERDUE TASKS (\d+)/],
    ["conflicts", /(\d+) CONFLICTS/],
    ["submitted", /SUB (\d+)/],
    ["unreviewed", /UNREVIEWED (\d+)/],
  ] as const;

  const seen = new Map<string, Map<string, string>>();

  for (const route of [
    "/admin",
    "/admin/submissions",
    "/admin/sessions",
    "/admin/speakers",
    "/admin/tasks",
    "/admin/forms",
  ]) {
    await page.goto(route);
    await expect(page.locator("header")).toBeVisible({ timeout: 20_000 });
    const text = await page.locator("header + div").first().innerText();
    for (const [key, pattern] of LABELS) {
      const found = text.match(pattern)?.[1];
      if (found === undefined) continue; // this screen does not carry that label
      const byRoute = seen.get(key) ?? new Map<string, string>();
      byRoute.set(route, found);
      seen.set(key, byRoute);
    }
  }

  for (const [key, byRoute] of seen) {
    const values = new Set(byRoute.values());
    expect(
      [...values],
      `${key} differs across screens: ${JSON.stringify([...byRoute])}`,
    ).toHaveLength(1);
  }

  // The prototype's numbers, specifically. Zero everywhere would pass the check
  // above while still being the bug, if the seed happened to match.
  expect(seen.get("overdue")?.size ?? 0, "no screen showed an overdue count").toBeGreaterThan(1);
});
