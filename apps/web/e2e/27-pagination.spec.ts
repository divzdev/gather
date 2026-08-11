import { expect, test, type Page } from "@playwright/test";

/** Long lists are paged, and every status is reachable from the top.
 *
 *  The console asked each list endpoint for a fixed slice — 100 or 200 rows —
 *  and rendered whatever came back, so Submissions read "200 of 608 matching"
 *  and the other 408 could not be reached by any route through the UI. The API
 *  has returned `meta {total, page, per_page, pages}` since the first
 *  migration; the frontend threw it away.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
});

/** What the pager says it is showing. These tables are built from divs rather
 *  than a `<table>`, so there are no `role="row"` nodes to count — the pager's
 *  own summary is the honest source, and it is the thing under test anyway. */
async function shownRange(page: Page): Promise<{ first: number; last: number; total: number }> {
  const summary = page.getByText(/\d+ — \d+ of \d+/);
  await expect(summary).toBeVisible({ timeout: 20_000 });
  const text = (await summary.innerText()).replace(/,/g, "");
  const [, first, last, total] = /(\d+) — (\d+) of (\d+)/.exec(text) ?? [];
  return { first: Number(first), last: Number(last), total: Number(total) };
}

/** The six-character submission codes on screen, in order — the cheapest
 *  identity for "which rows am I looking at". Column headings are six capitals
 *  too, so the ones that are words are dropped. */
const HEADINGS = new Set(["FORMAT", "STATUS", "SPEAKER"]);

async function codesOnPage(page: Page): Promise<string[]> {
  const found = await page.getByText(/^[0-9A-Z]{6}$/).allInnerTexts();
  return found.filter((text) => !HEADINGS.has(text));
}

test("submissions opens on one page of a much longer list", async ({ page }) => {
  await page.goto("/admin/submissions");

  const { first, last, total } = await shownRange(page);
  expect(first).toBe(1);
  expect(last).toBe(25);
  // The point of the whole change: the total is the event's, not the page's.
  expect(total).toBeGreaterThan(25);
});

test("the second page is a different page, and going back returns the first", async ({ page }) => {
  await page.goto("/admin/submissions");
  await shownRange(page);

  const firstPage = await codesOnPage(page);
  expect(firstPage.length, "no submission codes on screen to compare").toBeGreaterThan(0);

  await page.getByRole("button", { name: "Page 2" }).click();

  // Polled on the rows rather than on the pager's label. The label is driven by
  // the click and updates at once; the rows are held at the previous page until
  // the request lands, deliberately, so that turning a page does not blank the
  // table. Asserting on the label would pass before anything had been fetched.
  await expect
    .poll(async () => (await codesOnPage(page))[0], { timeout: 15_000 })
    .not.toBe(firstPage[0]);

  const secondPage = await codesOnPage(page);
  expect(secondPage, "page 2 rendered page 1 again").not.toEqual(firstPage);
  // Not merely reordered — page 2 holds rows page 1 never had.
  expect(secondPage.some((code) => !firstPage.includes(code))).toBe(true);
  expect((await shownRange(page)).first).toBe(26);

  await page.getByRole("button", { name: "Previous page" }).click();
  await expect
    .poll(async () => (await codesOnPage(page))[0], { timeout: 15_000 })
    .toBe(firstPage[0]);
});

test("showing more rows shows more rows", async ({ page }) => {
  await page.goto("/admin/submissions");
  await shownRange(page);

  await page.getByLabel("Rows per page").selectOption("100");

  // Not merely a changed label: the range the list reports has to widen, which
  // it only can if the request that produced it changed too.
  await expect.poll(async () => (await shownRange(page)).last, { timeout: 15_000 }).toBe(100);
});

test("every submission status is one click from the top of the list", async ({ page }) => {
  await page.goto("/admin/submissions");
  const tabs = page.getByRole("tablist", { name: /filter by status/i });
  await expect(tabs).toBeVisible({ timeout: 20_000 });

  // Withdrawn and Draft were reachable only through a multi-select popover
  // three controls in from the edge of the screen.
  for (const label of ["Draft", "Submitted", "In review", "Accepted", "Waitlisted", "Rejected"]) {
    await expect(tabs.getByRole("tab", { name: new RegExp(`^${label}`) })).toBeVisible();
  }

  const everything = (await shownRange(page)).total;

  await tabs.getByRole("tab", { name: /^Rejected/ }).click();
  await expect(tabs.getByRole("tab", { name: /^Rejected/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Narrower than the whole event, measured against what the list actually
  // held a moment ago rather than against a number written into the test —
  // a hard-coded total only means anything until the next reseed.
  await expect
    .poll(async () => (await shownRange(page)).total, { timeout: 15_000 })
    .toBeLessThan(everything);
  const statuses = await page.getByText("Rejected", { exact: true }).count();
  expect(statuses, "a status tab that filtered nothing").toBeGreaterThan(0);
});

test("choosing a status returns to the first page rather than a page that no longer exists", async ({
  page,
}) => {
  await page.goto("/admin/submissions");
  await shownRange(page);
  const tabs = page.getByRole("tablist", { name: /filter by status/i });

  // Whichever status this event has too few of to fill three pages. Naming one
  // outright ties the test to a particular seed — "Withdrawn is empty" was true
  // of the database this was written against, not a property of the product.
  //
  // Read rather than matched: a tab's label and its count are adjacent spans, so
  // its text is "Draft0" with no separator, and a regex looking for a trailing
  // count silently matches nothing. That skipped this test rather than failing
  // it, which is the worse of the two outcomes.
  const labels = await tabs.getByRole("tab").allInnerTexts();
  const short = labels
    .map((text) => /^(.*?)(\d+)$/.exec(text.replace(/\s+/g, "")))
    .filter((match): match is RegExpExecArray => match !== null)
    .find(([, name, count]) => name !== "All" && Number(count) < 51);
  expect(short, "every status fills three pages, so no page can vanish").toBeDefined();

  await page.getByRole("button", { name: "Page 3" }).click();
  await expect.poll(async () => (await shownRange(page)).first, { timeout: 15_000 }).toBe(51);

  await tabs.getByRole("tab", { name: new RegExp(`^${short![1]}`) }).click();

  // Page 3 of that status does not exist. Staying on it would leave a blank
  // table with no explanation and no way back. Asserted on the pager rather
  // than on the row range, because a status with no rows at all reports "No
  // proposals" and has no range to read.
  await expect(page.getByRole("button", { name: "Page 3" })).toBeHidden({ timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Page 1" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("the speaker roster is paged too", async ({ page }) => {
  await page.goto("/admin/speakers");

  const { first, last, total } = await shownRange(page);
  expect(first).toBe(1);
  expect(last).toBe(25);
  expect(total).toBeGreaterThan(25);
});

test("a speaker can be added to the roster from the page header", async ({ page }) => {
  await page.goto("/admin/speakers");
  const before = (await shownRange(page)).total;

  // The roster had no way to add anybody at all: an invited keynote, the one
  // speaker who never submits, could not be put on the list.
  await page.getByRole("button", { name: /add speaker/i }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toBeVisible();

  // A refusal keeps the drawer open and says why.
  await drawer.getByLabel(/full name/i).fill("Invited Keynote");
  await drawer.getByLabel(/^email$/i).fill("not-an-email");
  await drawer.getByRole("button", { name: /^add speaker$/i }).click();
  await expect(drawer.getByRole("alert")).toContainText(/email address/i);
  await expect(drawer, "a refused submit closed the drawer").toBeVisible();

  const email = `keynote-${Date.now()}@example.com`;
  await drawer.getByLabel(/^email$/i).fill(email);
  await drawer.getByRole("button", { name: /^add speaker$/i }).click();

  await expect(drawer).toBeHidden({ timeout: 15_000 });
  await expect
    .poll(async () => (await shownRange(page)).total, { timeout: 15_000 })
    .toBe(before + 1);
});

test("the session library is paged too", async ({ page }) => {
  await page.goto("/admin/sessions");

  const { first, total } = await shownRange(page);
  expect(first).toBe(1);
  expect(total).toBeGreaterThan(25);
});
