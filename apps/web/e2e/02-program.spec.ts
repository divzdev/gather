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

/** The add-form moved off the bottom of the list into a drawer opened from the
 *  page header, so creating is reached from the top of the screen rather than
 *  from below every row already on it. Returns the drawer, which stays open
 *  when the submit is refused. */
async function openAdd(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: /^add a /i }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();
  return drawer;
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
  const name = `Hall ${Date.now()}`;

  const drawer = await openAdd(page);
  await drawer.getByLabel(/room name/i).fill(name);
  await drawer.getByLabel(/capacity/i).fill("240");
  await drawer.getByRole("button", { name: /add room/i }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });

  await expect(row(panel(page), name)).toContainText("seats 240", { timeout: 15_000 });

  await page.reload();
  const after = panel(page);
  await expect(row(after, name)).toContainText("seats 240", { timeout: 15_000 });

  await removeRow(after, name);
});

test("19. a track carries a colour", async ({ page }) => {
  await openProgram(page, "tracks");
  const name = `Track ${Date.now()}`;

  const drawer = await openAdd(page);
  await drawer.getByLabel(/track name/i).fill(name);
  // Colour is the palette itself rather than a number between 1 and 8.
  await drawer.getByRole("radio", { name: "Colour 4" }).click();
  await drawer.getByRole("button", { name: /add track/i }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });

  const after = panel(page);
  await expect(row(after, name)).toContainText("colour 4", { timeout: 15_000 });
  await removeRow(after, name);
});

test("20. a format keeps its default duration", async ({ page }) => {
  await openProgram(page, "session-formats");
  const name = `Format ${Date.now()}`;

  const drawer = await openAdd(page);
  await drawer.getByLabel(/format name/i).fill(name);
  await drawer.getByLabel(/default minutes/i).fill("45");
  await drawer.getByRole("button", { name: /add format/i }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });

  const after = panel(page);
  await expect(row(after, name)).toContainText("45 min by default", { timeout: 15_000 });
  await removeRow(after, name);
});

test("20b. a nonsense duration is refused with a reason", async ({ page }) => {
  await openProgram(page, "session-formats");

  const drawer = await openAdd(page);
  await drawer.getByLabel(/format name/i).fill("Impossible");
  await drawer.getByLabel(/default minutes/i).fill("9000");
  await drawer.getByRole("button", { name: /add format/i }).click();

  await expect(drawer.getByRole("alert")).toContainText(/between 5 and 600/i);
  await expect(drawer, "a refused submit closed the drawer").toBeVisible();
});

test("21. an event day is added and removed again", async ({ page }) => {
  await openProgram(page, "days");
  const label = `Day ${Date.now()}`;
  // A date far enough out, and jittered, that concurrent or repeated runs cannot
  // collide on the unique (event, date) pair — a collision here fails the add
  // and made this flake in the full suite while passing alone.
  const offset = 900 + Math.floor(Math.random() * 5000);
  const date = new Date(Date.now() + 86_400_000 * offset).toISOString().slice(0, 10);

  const drawer = await openAdd(page);
  await drawer.getByLabel(/^date$/i).fill(date);
  // The window the agenda grid draws for this day. It was collected by nobody
  // and defaulted to 09:00–18:00 for every day, so a workshop afternoon and a
  // keynote morning were indistinguishable and unchangeable.
  await expect(drawer.getByLabel(/doors open/i), "the create form suggests no hours").toHaveValue(
    "09:00",
  );
  await drawer.getByLabel(/doors open/i).fill("13:00");
  await drawer.getByLabel(/doors close/i).fill("20:30");
  await drawer.getByLabel(/^label$/i).fill(label);
  await drawer.getByRole("button", { name: /add day/i }).click();

  // The drawer only closes on success, so a refusal surfaces here rather than
  // timing out on a row that was never created.
  await expect(drawer.getByRole("alert")).toHaveCount(0);
  await expect(drawer).toBeHidden({ timeout: 15_000 });

  // The row leads with its date and carries the label after it. It used to show
  // the label *instead of* the date, so a day labelled "25" told you nothing
  // about when it was — which is why the controls are named by date now.
  const shown = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

  const after = panel(page);
  await expect(row(after, label)).toContainText(shown, { timeout: 15_000 });
  // The hours that were typed, not the API's default.
  await expect(row(after, label)).toContainText("13:00–20:30 open");
  // A day with nothing on it says so, rather than echoing its opening window
  // back and reading like a day that has been built.
  await expect(row(after, label)).toContainText("nothing scheduled yet");

  // Reopening shows what was saved, and a day cannot be made to close before it
  // opens — refused in the browser, with the two times named rather than the
  // two field names.
  await page.getByRole("button", { name: `Edit ${shown}` }).click();
  const edit = page.getByRole("dialog");
  await expect(edit.getByLabel(/doors open/i)).toHaveValue("13:00");
  await expect(edit.getByLabel(/doors close/i)).toHaveValue("20:30");

  await edit.getByLabel(/doors close/i).fill("10:00");
  await edit.getByRole("button", { name: /save changes/i }).click();
  await expect(edit.getByRole("alert")).toContainText(/cannot close at 10:00 and open at 13:00/i);
  await expect(edit, "a refused save closed the drawer").toBeVisible();
  await page.keyboard.press("Escape");
  await expect(edit).toBeHidden();

  await removeRow(after, shown);
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

  // 23. Nothing points at it, so it goes cleanly.
  const throwaway = `Doomed ${Date.now()}`;
  const drawer = await openAdd(page);
  await drawer.getByLabel(/track name/i).fill(throwaway);
  await drawer.getByRole("button", { name: /add track/i }).click();
  await expect(drawer).toBeHidden({ timeout: 15_000 });
  await expect(row(panel(page), throwaway)).toBeVisible({ timeout: 15_000 });
  await removeRow(panel(page), throwaway);

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

  await page.getByRole("button", { name: new RegExp(`Remove ${busy!.name}`) }).click();
  // The refusal is a sibling of the list, not inside it, so it stays put while
  // the list re-renders underneath. Matched by tag as well as role: Next's
  // route announcer is also role="alert" and is always on the page.
  await expect(page.locator('p[role="alert"]')).toContainText(/still use this|in use/i, {
    timeout: 15_000,
  });
  // And it is still there.
  await expect(page.getByText(busy!.name, { exact: true }).first()).toBeVisible();
});
