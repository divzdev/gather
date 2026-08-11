import { expect, test } from "@playwright/test";

/** One header, on every console page.
 *
 *  The console's thirteen generated screens each shipped their prototype's
 *  header inline, and they drifted: search on two of them at two different
 *  widths, a notification bell on two, a density toggle and a `?` on exactly
 *  one, the page name in seven, page actions in six, and two screens with no
 *  header at all. A header that changes shape as you navigate reads as a
 *  different application on every click.
 *
 *  This is the regression guard. It walks the header's own children on every
 *  route and requires the same list everywhere — not a spot-check of one or two
 *  pages, which is exactly how the drift went unnoticed the first time.
 */

const ROUTES = [
  "/admin",
  "/admin/submissions",
  "/admin/sessions",
  "/admin/review",
  "/admin/speakers",
  "/admin/agenda",
  "/admin/tasks",
  "/admin/messages",
  "/admin/forms",
  "/admin/publishing",
  "/admin/settings",
  "/admin/directory",
  "/admin/program",
  "/admin/program/rooms",
  "/review",
] as const;

/** What the header is made of, in order.
 *
 *  Accessible names, never text content: the event name and the signed-in user
 *  are data, and a signature that included them would fail on a differently
 *  seeded database instead of on the drift this is watching for. */
async function signature(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => {
    const header = document.querySelector("header");
    if (header === null) return ["NO HEADER"];

    const labelOf = (el: Element): string | null =>
      el.getAttribute("aria-label") ?? el.getAttribute("title");

    const name = (node: Element): string => {
      const own = labelOf(node);
      if (own !== null) return `${node.tagName.toLowerCase()}:${own}`;
      // Wrappers exist only so a popover can hang off them — describe them by
      // the control they hold, not by whatever text happens to be inside.
      const labelled = node.querySelector("[aria-label], [title]");
      if (labelled !== null) {
        return `${node.tagName.toLowerCase()}>${labelled.tagName.toLowerCase()}:${labelOf(labelled) ?? ""}`;
      }
      const text = (node.textContent ?? "").trim();
      return `${node.tagName.toLowerCase()}:${text === "" ? "—" : text.slice(0, 24)}`;
    };

    return [...header.children]
      .filter((node) => node.tagName.toLowerCase() !== "style")
      .map(name);
  });
}

/** The event query decides the switcher's contents; nothing below should be
 *  measured while it still reads "Loading…". */
async function settle(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator('[aria-label="Switch event"]')).not.toContainText("Loading", {
    timeout: 20_000,
  });
}

test.describe("console header", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /^Organizer$/i }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  });

  test("every console route renders the identical header", async ({ page }) => {
    const seen = new Map<string, string[]>();

    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator("header")).toBeVisible({ timeout: 20_000 });
      await settle(page);
      seen.set(route, await signature(page));
    }

    const reference = seen.get(ROUTES[0]);
    expect(reference, "the first route produced no header").toBeDefined();
    for (const [route, children] of seen) {
      expect(children, `${route} has a different header`).toEqual(reference);
    }
  });

  test("search is on every page, at one width", async ({ page }) => {
    const widths = new Map<string, number>();

    for (const route of ROUTES) {
      await page.goto(route);
      await settle(page);
      const search = page.locator("header").getByRole("button", { name: /search or jump to/i });
      await expect(search, `${route} has no search`).toBeVisible({ timeout: 20_000 });
      const box = await search.boundingBox();
      widths.set(route, Math.round(box?.width ?? 0));
    }

    const distinct = new Set(widths.values());
    expect([...distinct], `search widths differ: ${JSON.stringify([...widths])}`).toHaveLength(1);
  });

  test("no page name and no page action sits in the header", async ({ page }) => {
    // Every action that used to live up there, and every page name that did.
    const strays = [
      "Add a session",
      "New plan",
      "Download all files",
      "Nudge all overdue",
      "View public page",
      "Options",
      "Back to forms",
      "View live form",
      "Overview",
      "Sessions",
      "Publishing",
      "Settings",
      "Evaluation plans",
    ];

    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator("header")).toBeVisible({ timeout: 20_000 });
      const text = (await page.locator("header").innerText()).toLowerCase();
      for (const stray of strays) {
        expect(text, `${route} still shows "${stray}" in the header`).not.toContain(
          stray.toLowerCase(),
        );
      }
    }
  });

  test("the event switcher survives on every screen", async ({ page }) => {
    // Guards the same contract 01-account.spec.ts test 17 relies on.
    for (const route of ROUTES) {
      await page.goto(route);
      const switcher = page.locator('[aria-label="Switch event"]');
      await expect(switcher, `${route} lost the event switcher`).toBeVisible({ timeout: 20_000 });
    }
  });
});
