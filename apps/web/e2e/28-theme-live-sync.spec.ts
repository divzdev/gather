import { expect, test } from "@playwright/test";

/** The theme attribute must track its sources while the page is open.
 *
 *  ThemeProvider subscribes to `prefers-color-scheme` changes and cross-tab
 *  `storage` events, so React state follows both — but only `setMode` calls
 *  `applyTheme`, which is what writes `data-theme` onto <html>. These tests
 *  pin the visible half: when a source changes, the attribute (and therefore
 *  the whole tokens.css palette) must change with it.
 */

test("system mode follows an OS scheme change without a reload", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await page.emulateMedia({ colorScheme: "dark" });

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark", { timeout: 3000 });
});

test("a theme change in another tab reaches this one", async ({ context }) => {
  const pageA = await context.newPage();
  await pageA.emulateMedia({ colorScheme: "light" });
  await pageA.goto("/login");
  await expect(pageA.locator("html")).toHaveAttribute("data-theme", "light");

  const pageB = await context.newPage();
  await pageB.emulateMedia({ colorScheme: "light" });
  await pageB.goto("/login");
  await pageB.evaluate(() => localStorage.setItem("gather.theme", "dark"));
  // Same-origin localStorage writes fire `storage` in every *other* tab.

  await expect(pageA.locator("html")).toHaveAttribute("data-theme", "dark", { timeout: 3000 });
});

test("a stale pre-0002 accent key neither crashes boot nor tints the chrome", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("gather.accent", "Coral");
    localStorage.setItem("gather.theme", "light");
  });
  await page.goto("/login");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const inline = await page.evaluate(() => document.documentElement.getAttribute("style") ?? "");
  // The retired boot script wrote --sg/--bt etc. inline; the new one must not.
  expect(inline).not.toMatch(/--(sg|sw|sl|bt|bf):/);
});

test("garbage in gather.theme falls back to system, not a crash", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => localStorage.setItem("gather.theme", '{"mode":"???"}'));
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
