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

/** Each piece of the program skeleton now has its own screen behind a section
 *  nav, rather than being one of four editors stacked on a single scroll. */
type Section = "rooms" | "tracks" | "session-formats" | "days";

async function openProgram(page: Page, section: Section) {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
  await page.goto(`/admin/program/${section}`);
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 });
}

/** The editor on the current section page. There is only one. */
function panel(page: Page): Locator {
  return page.locator("main section, section").last();
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
  await openProgram(page, "rooms");
  const rooms = panel(page);
  const name = `Hall ${Date.now()}`;

  await rooms.getByLabel(/room name/i).fill(name);
  await rooms.getByLabel(/capacity/i).fill("240");
  await rooms.getByRole("button", { name: /^Add$/ }).click();

  await expect(row(rooms, name)).toContainText("seats 240", { timeout: 15_000 });

  await page.reload();
  const after = panel(page);
  await expect(row(after, name)).toContainText("seats 240", { timeout: 15_000 });

  await removeRow(after, name);
});

test("19. a track carries a colour", async ({ page }) => {
  await openProgram(page, "tracks");
  const tracks = panel(page);
  const name = `Track ${Date.now()}`;

  await tracks.getByLabel(/track name/i).fill(name);
  await tracks.getByLabel(/colour/i).fill("4");
  await tracks.getByRole("button", { name: /^Add$/ }).click();

  await expect(row(tracks, name)).toContainText("colour 4", { timeout: 15_000 });
  await removeRow(tracks, name);
});

test("20. a format keeps its default duration", async ({ page }) => {
  await openProgram(page, "session-formats");
  const formats = panel(page);
  const name = `Format ${Date.now()}`;

  await formats.getByLabel(/format name/i).fill(name);
  await formats.getByLabel(/default minutes/i).fill("45");
  await formats.getByRole("button", { name: /^Add$/ }).click();

  await expect(row(formats, name)).toContainText("45 min by default", { timeout: 15_000 });
  await removeRow(formats, name);
});

test("20b. a nonsense duration is refused with a reason", async ({ page }) => {
  await openProgram(page, "session-formats");
  const formats = panel(page);

  await formats.getByLabel(/format name/i).fill("Impossible");
  await formats.getByLabel(/default minutes/i).fill("9000");
  await formats.getByRole("button", { name: /^Add$/ }).click();

  await expect(formats.getByRole("alert")).toContainText(/between 5 and 600/i);
});

test("21. an event day is added and removed again", async ({ page }) => {
  await openProgram(page, "days");
  const days = panel(page);
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

test("23-24. an unused track deletes; one in use does not crash the screen", async ({
  page,
  request,
}) => {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const eventId = ((await events.json()) as { id: string }[])[0]!.id;

  await openProgram(page, "tracks");
  const tracks = panel(page);

  // 23. Nothing points at it, so it goes cleanly.
  const throwaway = `Doomed ${Date.now()}`;
  await tracks.getByLabel(/track name/i).fill(throwaway);
  await tracks.getByRole("button", { name: /^Add$/ }).click();
  await expect(row(tracks, throwaway)).toBeVisible({ timeout: 15_000 });
  await removeRow(tracks, throwaway);

  // 24. A track with sessions on it is refused, and says how many. It used to
  // succeed: the foreign key is ON DELETE SET NULL, so deleting silently
  // stripped the track off every session that used it.
  //
  // The in-use track is found rather than named: hard-coding a seeded name made
  // this pass vacuously once an earlier run had deleted that very track, which
  // is precisely the failure it exists to catch.
  const sessions = await request.get(`${API}/v1/events/${eventId}/sessions`, { headers });
  const used = new Set(
    ((await sessions.json()) as { track_id: string | null }[])
      .map((row) => row.track_id)
      .filter((id): id is string => id !== null),
  );
  const listing = await request.get(`${API}/v1/events/${eventId}/tracks`, { headers });
  const busy = ((await listing.json()) as { id: string; name: string }[]).find((row) =>
    used.has(row.id),
  );
  expect(busy, "no track has any session on it, so nothing can be in use").toBeDefined();

  await tracks.getByRole("button", { name: new RegExp(`Remove ${busy!.name}`) }).click();
  await expect(tracks.getByRole("alert")).toContainText(/still use this|in use/i, {
    timeout: 15_000,
  });
  // And it is still there.
  await expect(tracks.getByText(busy!.name, { exact: true }).first()).toBeVisible();
});
