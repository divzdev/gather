import { expect, test } from "@playwright/test";

/** A new organiser names their own event.
 *
 *  Registering used to invent one — named after whatever was typed in a box
 *  labelled "Event or organization", dated ninety days out — so the first screen
 *  described a conference nobody had agreed to. And nothing could create an
 *  event: the API had no POST, so that invented one was the only one you would
 *  ever have.
 */
test("signing up asks for the event rather than inventing it", async ({ page }) => {
  const stamp = Date.now();
  await page.goto("/login");
  await page.getByRole("button", { name: /create an account/i }).click();

  await page.getByLabel(/full name/i).fill("Divya Manchireddy");
  await page.getByLabel(/^email$/i).fill(`ob${stamp}@test.com`);
  await page.getByLabel(/^password$/i).fill("a-long-enough-passphrase");
  // No organisation field any more: the redesigned screen dropped it, and
  // the workspace is named after the owner until Settings renames it.
  await page.getByRole("button", { name: /create account/i }).click();

  // Straight to onboarding, not to a console describing an event nobody chose.
  await expect(page).toHaveURL(/\/admin\/events\/new/, { timeout: 25_000 });
  await expect(page.getByRole("heading", { name: /let.s make an event/i })).toBeVisible();

  await page.getByLabel(/what is it called/i).fill(`Testfest ${stamp}`);
  await page.getByLabel(/first day/i).fill("2027-09-14");
  await page.getByLabel(/last day/i).fill("2027-09-16");
  await page.getByLabel(/timezone/i).selectOption("Europe/London");
  await page.getByLabel(/^where/i).fill("Barbican, London");
  await page.getByRole("button", { name: /create the event/i }).click();

  await expect(page).toHaveURL(/\/admin$/, { timeout: 25_000 });
  await page.waitForLoadState("networkidle");

  // The console describes the event the organiser actually named.
  await expect(page.locator("body")).toContainText(`Testfest ${stamp}`, { timeout: 20_000 });

  // And it persists, with the dates and zone that were chosen.
  await page.goto("/admin/settings");
  await expect(page.getByLabel(/event name/i)).toHaveValue(`Testfest ${stamp}`, { timeout: 20_000 });
  await expect(page.getByLabel(/^starts$/i)).toHaveValue("2027-09-14");
});

test("an owner who already has an event is not asked again", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  await expect(page).not.toHaveURL(/events\/new/);
});
