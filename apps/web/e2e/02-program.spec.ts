import { expect, test, type Locator, type Page } from "@playwright/test";

/** Checklist §"Program setup" — items 18-24.
 *
 *  These run against the real seeded database, so each one removes what it added.
 *  Without that, a second run finds two "seats 240" rows and the assertions stop
 *  meaning anything.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

async function openProgram(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  await page.goto("/admin/program");
  await expect(page.getByRole("heading", { name: /program setup/i })).toBeVisible({
    timeout: 15_000,
  });
}

function panel(page: Page, title: RegExp): Locator {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: title }) });
}

/** The row carrying a given name, so assertions never catch a neighbour. */
function row(section: Locator, name: string): Locator {
  return section.locator("div").filter({ hasText: name }).last();
}

async function removeRow(section: Locator, name: string) {
  await section.getByRole("button", { name: new RegExp(`Remove ${name}`) }).click();
  await expect(section.getByText(name, { exact: false })).toHaveCount(0, { timeout: 15_000 });
}

test("18. a room is added, keeps its capacity, and survives a reload", async ({ page }) => {
  await openProgram(page);
  const rooms = panel(page, /^Rooms$/);
  const name = `Hall ${Date.now()}`;

  await rooms.getByLabel(/room name/i).fill(name);
  await rooms.getByLabel(/capacity/i).fill("240");
  await rooms.getByRole("button", { name: /^Add$/ }).click();

  await expect(row(rooms, name)).toContainText("seats 240", { timeout: 15_000 });

  await page.reload();
  const after = panel(page, /^Rooms$/);
  await expect(row(after, name)).toContainText("seats 240", { timeout: 15_000 });

  await removeRow(after, name);
});

test("19. a track carries a colour", async ({ page }) => {
  await openProgram(page);
  const tracks = panel(page, /^Tracks$/);
  const name = `Track ${Date.now()}`;

  await tracks.getByLabel(/track name/i).fill(name);
  await tracks.getByLabel(/colour/i).fill("4");
  await tracks.getByRole("button", { name: /^Add$/ }).click();

  await expect(row(tracks, name)).toContainText("colour 4", { timeout: 15_000 });
  await removeRow(tracks, name);
});

test("20. a format keeps its default duration", async ({ page }) => {
  await openProgram(page);
  const formats = panel(page, /session formats/i);
  const name = `Format ${Date.now()}`;

  await formats.getByLabel(/format name/i).fill(name);
  await formats.getByLabel(/default minutes/i).fill("45");
  await formats.getByRole("button", { name: /^Add$/ }).click();

  await expect(row(formats, name)).toContainText("45 min by default", { timeout: 15_000 });
  await removeRow(formats, name);
});

test("20b. a nonsense duration is refused with a reason", async ({ page }) => {
  await openProgram(page);
  const formats = panel(page, /session formats/i);

  await formats.getByLabel(/format name/i).fill("Impossible");
  await formats.getByLabel(/default minutes/i).fill("9000");
  await formats.getByRole("button", { name: /^Add$/ }).click();

  await expect(formats.getByRole("alert")).toContainText(/between 5 and 600/i);
});

test("21. an event day is added and removed again", async ({ page }) => {
  await openProgram(page);
  const days = panel(page, /event days/i);
  const label = `Day ${Date.now()}`;
  // A date far enough out, and jittered, that concurrent or repeated runs cannot
  // collide on the unique (event, date) pair — a collision here fails the add
  // and made this flake in the full suite while passing alone.
  const offset = 900 + Math.floor(Math.random() * 5000);
  const date = new Date(Date.now() + 86_400_000 * offset).toISOString().slice(0, 10);

  await days.getByLabel(/^date$/i).fill(date);
  await days.getByLabel(/^label$/i).fill(label);
  await days.getByRole("button", { name: /^Add$/ }).click();

  // If the add was refused, say so here rather than timing out on the row.
  await expect(days.getByRole("alert")).toHaveCount(0);
  await expect(row(days, label)).toContainText("09:00–18:00", { timeout: 15_000 });
  await removeRow(days, label);
});

test("23-24. an unused track deletes; one in use does not crash the screen", async ({ page }) => {
  await openProgram(page);
  const tracks = panel(page, /^Tracks$/);

  // 23. Nothing points at it, so it goes cleanly.
  const throwaway = `Doomed ${Date.now()}`;
  await tracks.getByLabel(/track name/i).fill(throwaway);
  await tracks.getByRole("button", { name: /^Add$/ }).click();
  await expect(row(tracks, throwaway)).toBeVisible({ timeout: 15_000 });
  await removeRow(tracks, throwaway);

  // 24. A track with sessions on it is refused, and says how many. It used to
  // succeed: the foreign key is ON DELETE SET NULL, so deleting silently
  // stripped the track off every session that used it.
  const inUse = tracks.getByRole("button", { name: /Remove AI Engineering/i });
  if ((await inUse.count()) > 0) {
    await inUse.click();
    await expect(tracks.getByRole("alert")).toContainText(/still use this|in use/i, {
      timeout: 15_000,
    });
    // And it is still there.
    await expect(tracks.getByText("AI Engineering", { exact: true })).toBeVisible();
  }
});
