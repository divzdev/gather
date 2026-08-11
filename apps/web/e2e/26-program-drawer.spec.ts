import { expect, test } from "@playwright/test";

/** Creating a program record starts from the top of the screen.
 *
 *  Every one of these editors used to carry its add-form underneath the list it
 *  adds to, which puts the screen's primary action below every row on it. At
 *  four rooms that is odd; at two hundred the control is off-screen, and the
 *  empty state's only advice was to look further down. The form now lives in a
 *  drawer opened from the page header.
 */

const SECTIONS = [
  { path: "days", title: "Event days", cta: /add a day/i, submit: /add day/i },
  { path: "rooms", title: "Rooms", cta: /add a room/i, submit: /add room/i },
  { path: "tracks", title: "Tracks", cta: /add a track/i, submit: /add track/i },
  {
    path: "session-formats",
    title: "Session formats",
    cta: /add a format/i,
    submit: /add format/i,
  },
] as const;

/** The page heading renders before the list query resolves, so counting rows
 *  straight after it sees zero — which skips a test that should run, and lets a
 *  "every row has an Edit" assertion pass against no rows at all. */
async function settled(page: import("@playwright/test").Page): Promise<void> {
  await page
    .locator('[aria-label^="Edit "], [aria-label^="Add the first"]')
    .first()
    .waitFor({ state: "visible", timeout: 20_000 });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
});

test("every program section creates from the page header, not from below the list", async ({
  page,
}) => {
  for (const section of SECTIONS) {
    await page.goto(`/admin/program/${section.path}`);
    await expect(page.getByRole("heading", { name: section.title })).toBeVisible({
      timeout: 20_000,
    });

    // The trigger sits in the header beside the title, above the list.
    const trigger = page.getByRole("button", { name: section.cta });
    await expect(trigger, `${section.path} has no header action`).toBeVisible();

    const title = page.getByRole("heading", { name: section.title });
    const triggerBox = await trigger.boundingBox();
    const titleBox = await title.boundingBox();
    expect(
      Math.abs((triggerBox?.y ?? 0) - (titleBox?.y ?? 0)),
      `${section.path}'s add button is not beside the title`,
    ).toBeLessThan(80);

    await trigger.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer, `${section.path} opened no drawer`).toBeVisible();
    await expect(drawer.getByRole("button", { name: section.submit })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer, `${section.path}'s drawer ignored Escape`).toBeHidden();
  }
});

test("a room added in the drawer lands in the list behind it", async ({ page }) => {
  await page.goto("/admin/program/rooms");
  await expect(page.getByRole("heading", { name: "Rooms" })).toBeVisible({ timeout: 20_000 });

  const name = `Drawer room ${Date.now()}`;
  await page.getByRole("button", { name: /add a room/i }).click();

  const drawer = page.getByRole("dialog");
  await drawer.getByLabel(/room name/i).fill(name);
  await drawer.getByLabel(/capacity/i).fill("120");
  await drawer.getByRole("button", { name: /add room/i }).click();

  // Closing on success is the confirmation: the row it created is now visible.
  await expect(drawer).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText(name, { exact: false }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("seats 120").first()).toBeVisible();

  await page.getByRole("button", { name: new RegExp(`Remove ${name}`) }).click();
  await expect(page.getByText(name, { exact: false })).toHaveCount(0, { timeout: 15_000 });
});

test("the drawer refuses an empty name and says why, without closing", async ({ page }) => {
  await page.goto("/admin/program/rooms");
  await expect(page.getByRole("heading", { name: "Rooms" })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /add a room/i }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("button", { name: /add room/i }).click();

  await expect(drawer.getByRole("alert")).toContainText(/needs a name/i);
  await expect(drawer, "the drawer closed on a rejected submit").toBeVisible();
});

test("an empty section offers the way out of itself", async ({ page }) => {
  // Whichever section is empty on this database; the point is that no empty
  // state tells you to look below it for a form that is no longer there.
  for (const section of SECTIONS) {
    await page.goto(`/admin/program/${section.path}`);
    await expect(page.getByRole("heading", { name: section.title })).toBeVisible({
      timeout: 20_000,
    });
    const empty = page.getByText(/^No .* yet$/);
    if ((await empty.count()) === 0) continue;

    await expect(page.getByRole("button", { name: /add the first/i })).toBeVisible();
    expect(
      await page.getByText(/below/i).count(),
      `${section.path}'s empty state still points downwards`,
    ).toBe(0);
  }
});

test("a row can be edited in place, and the drawer opens filled in", async ({ page }) => {
  await page.goto("/admin/program/rooms");
  await expect(page.getByRole("heading", { name: "Rooms" })).toBeVisible({ timeout: 20_000 });

  // Its own row rather than a seeded one: this test changes what it opens.
  const name = `Edit me ${Date.now()}`;
  await page.getByRole("button", { name: /add a room/i }).click();
  let drawer = page.getByRole("dialog");
  await drawer.getByLabel(/room name/i).fill(name);
  await drawer.getByLabel(/capacity/i).fill("100");
  await drawer.getByRole("button", { name: /add room/i }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText("seats 100").first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: `Edit ${name}` }).click();
  drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading")).toContainText(name);
  // Opening an edit with empty fields is the bug this guards.
  await expect(drawer.getByLabel(/room name/i)).toHaveValue(name);
  await expect(drawer.getByLabel(/capacity/i)).toHaveValue("100");

  await drawer.getByLabel(/capacity/i).fill("450");
  await drawer.getByRole("button", { name: /save changes/i }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });
  await expect(page.getByText("seats 450").first()).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: `Remove ${name}` }).click();
  await expect(page.getByText(name, { exact: false })).toHaveCount(0, { timeout: 15_000 });
});

test("moving a day says what it drags with it, and only once it moves", async ({ page }) => {
  await page.goto("/admin/program/days");
  await expect(page.getByRole("heading", { name: "Event days" })).toBeVisible({ timeout: 20_000 });

  await settled(page);
  const edit = page.getByRole("button", { name: /^Edit / }).first();
  if ((await edit.count()) === 0) test.skip(true, "no event days on this database");
  await edit.click();

  const drawer = page.getByRole("dialog");
  const warning = drawer.getByText(/moves with it/i);
  // Opening an edit changes nothing, so it must not warn about anything.
  await expect(warning, "warned before anything was changed").toBeHidden();

  const date = drawer.getByLabel(/^date$/i);
  const original = await date.inputValue();
  await date.fill("2029-11-03");
  await expect(warning, "moved the day without saying what moves with it").toBeVisible();

  // Put it back rather than saving; this runs against the seeded demo.
  await date.fill(original);
  await expect(warning).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});

test("every section offers edit as well as remove", async ({ page }) => {
  for (const section of SECTIONS) {
    await page.goto(`/admin/program/${section.path}`);
    await expect(page.getByRole("heading", { name: section.title })).toBeVisible({
      timeout: 20_000,
    });
    await settled(page);
    const removes = await page.getByRole("button", { name: /^Remove / }).count();
    if (removes === 0) continue;
    expect(
      await page.getByRole("button", { name: /^Edit / }).count(),
      `${section.path} has ${removes} rows to remove but no way to edit them`,
    ).toBe(removes);
  }
});
