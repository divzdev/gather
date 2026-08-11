import { expect, test } from "@playwright/test";

/** "Your profile" leads to your profile.
 *
 *  The menu item existed from the first prototype and never went anywhere: a
 *  toast describing a screen that did not exist, then the event's settings,
 *  which are neither yours nor about you. A menu item that lies about where it
 *  goes is worse than one that is absent.
 */
test("the user menu opens a profile that shows and saves your own details", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });

  await page.getByRole("button", { name: /account menu/i }).click();
  const profile = page.getByRole("button", { name: /your profile/i }).first();
  await expect(profile, "the user menu has no profile item").toBeVisible({ timeout: 10_000 });
  await profile.click();

  await expect(page).toHaveURL(/\/admin\/profile/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: /your profile/i })).toBeVisible();

  // It shows who you actually are, not the event.
  const name = page.getByLabel(/^name$/i);
  await expect(name).toHaveValue(/\w/);
  await expect(page.getByLabel(/^email$/i)).toHaveValue(/@/);
  // Email is the login identity, so it is shown and not editable.
  await expect(page.getByLabel(/^email$/i)).toBeDisabled();
  await expect(page.locator("body")).toContainText(/owner|admin|coordinator|reviewer/i);

  // And an edit round-trips.
  const original = await name.inputValue();
  await name.fill(`${original} Jr`);
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText(/^Saved\.$/)).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByLabel(/^name$/i)).toHaveValue(`${original} Jr`, { timeout: 20_000 });

  await page.getByLabel(/^name$/i).fill(original);
  await page.getByRole("button", { name: /^Save$/ }).click();
  await expect(page.getByText(/^Saved\.$/)).toBeVisible({ timeout: 10_000 });
});
