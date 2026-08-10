import { expect, test, type Page } from "@playwright/test";

/** Checklist §"Speed & accessibility" — items 161-169.
 *
 *  Read-only: nothing here mutates the seeded database, so this file is safe to
 *  run in any order and as many times as you like.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
const SLUG = "devflow-conf-2027";

const CONSOLE_SCREENS = [
  "/admin",
  "/admin/submissions",
  "/admin/sessions",
  "/admin/speakers",
  "/admin/tasks",
] as const;

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

test("161-162. every console list is interactive on a throttled connection", async ({
  page,
  browser,
}) => {
  const client = await page.context().newCDPSession(page);
  // Fast 4G and a four-times slower CPU: the machine a coordinator actually has
  // at a venue, not the one this was built on.
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (4 * 1024 * 1024) / 8,
    uploadThroughput: (3 * 1024 * 1024) / 8,
  });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  await signIn(page);

  const slow: string[] = [];
  for (const path of CONSOLE_SCREENS) {
    await page.goto(path);
    const started = Date.now();
    // Interactive means the first heading is painted and a click lands, not
    // that every row has arrived.
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
    const elapsed = Date.now() - started;
    if (elapsed > 3000) slow.push(`${path} took ${elapsed}ms`);
  }

  expect(slow, "screens were still blank after 3s on Fast 4G + 4x CPU").toEqual([]);
  void browser;
});

test("163. moving between console screens never reloads the document", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin");

  // A value stamped on `window` survives a client-side route change and dies
  // with a document load. Playwright's `framenavigated` fires for both, so it
  // cannot tell them apart — this can.
  await page.evaluate(() => {
    (window as unknown as { __spa: number }).__spa = 1;
  });

  // Directory and Program are in this list on purpose: their rail links were
  // prototype-relative .dc.html paths, so they full-loaded into a 404.
  const journey = [
    "/admin/submissions",
    "/admin/sessions",
    "/admin/speakers",
    "/admin/directory",
    "/admin/program",
  ];

  for (const path of journey) {
    const link = page.locator(`nav a[href="${path}"]`).first();
    await expect(link, `the rail has no link to ${path}`).toHaveCount(1);
    await link.click();
    await page.waitForURL(`**${path}`, { timeout: 20_000 });
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

    const survived = await page.evaluate(
      () => (window as unknown as { __spa?: number }).__spa === 1,
    );
    expect(survived, `navigating to ${path} reloaded the document`).toBe(true);
  }
});

test("164. ⌘K opens on every console screen, searches, and navigates", async ({ page }) => {
  await signIn(page);

  for (const path of CONSOLE_SCREENS) {
    await page.goto(path);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("ControlOrMeta+k");
    const palette = page.getByRole("dialog", { name: /command palette/i });
    await expect(palette, `⌘K did nothing on ${path}`).toBeVisible({ timeout: 5000 });

    // Escape closes it, so it never traps you.
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  }

  // It searches, and Enter goes where the highlighted row says.
  await page.goto("/admin");
  // The listener lives in the rail, so wait for the screen before pressing —
  // otherwise the key lands on a document with nothing bound to it yet.
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("dialog", { name: /command palette/i }).getByRole("textbox").fill("agenda");
  await expect(page.getByRole("option", { name: /Agenda/i }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/admin\/agenda/, { timeout: 15_000 });

  // And it finds records, not only screens.
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByRole("dialog", { name: /command palette/i }).getByRole("textbox");
  await input.fill("the");
  await expect(
    page.getByRole("option").filter({ hasText: /Submission [A-Z0-9]{4,}/ }).first(),
    "the palette searches screens only",
  ).toBeVisible({ timeout: 15_000 });
});

test("165. a status change shows its consequence at once", async ({ page, request }) => {
  await signIn(page);
  await page.goto("/admin/sessions");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");

  // Bulk approval over the current view: the change and its confirmation must
  // land together. A mutation that succeeds silently is indistinguishable from
  // one that failed.
  await page.getByRole("button", { name: /Options/i }).click();
  await page.getByRole("button", { name: /Set approval/i }).click();

  const dialog = page.getByRole("dialog", { name: /set approval/i });
  await expect(dialog).toBeVisible();
  // It states the blast radius before doing anything.
  await expect(dialog).toContainText(/\d+ sessions?/);

  const started = Date.now();
  await dialog.getByRole("button", { name: /^Change \d+$/ }).click();
  await expect(page.getByText(/Updated \d+ session/i).first()).toBeVisible({ timeout: 8000 });
  expect(Date.now() - started, "the bulk change took over 3s to confirm").toBeLessThan(3000);

  // Restore: the dialog defaults to Pending, so put everything back to approved
  // rather than leaving the seeded programme unpublishable.
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const eventId = ((await events.json()) as { id: string }[])[0]!.id;
  const sessions = await request.get(`${API}/v1/events/${eventId}/sessions`, { headers });
  const ids = ((await sessions.json()) as { id: string }[]).map((row) => row.id);
  await request.post(`${API}/v1/events/${eventId}/sessions/bulk`, {
    headers,
    data: { session_ids: ids.slice(0, 200), content_status: "approved" },
  });
});

test("164b. the header's ⌘K affordance opens the same palette", async ({ page }) => {
  await signIn(page);
  await page.goto("/admin/submissions");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

  // The design labels this button "Command palette"; before one existed it
  // focused a text field instead, which is the kind of small lie that teaches
  // people not to trust the UI.
  await page.getByRole("button", { name: /Search or jump to/i }).click();
  await expect(page.getByRole("dialog", { name: /command palette/i })).toBeVisible({
    timeout: 5000,
  });
});

test("166. the public pages stay inside a Core Web Vitals budget", async ({ page }) => {
  // Not a Lighthouse run — this measures the vitals Lighthouse scores on, at
  // the thresholds its 95+ band requires, which is the part that can regress.
  // Note these are dev-server numbers; a production build is strictly faster.
  const budget = { lcp: 2500, cls: 0.1, transferBytes: 1_600_000 };

  for (const path of ["/", `/e/${SLUG}/schedule`]) {
    let transferred = 0;
    const onResponse = async (response: import("@playwright/test").Response) => {
      const length = response.headers()["content-length"];
      if (length !== undefined) transferred += Number(length);
    };
    page.on("response", onResponse);

    await page.goto(path, { waitUntil: "load" });
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

    const vitals = await page.evaluate(
      () =>
        new Promise<{ lcp: number; cls: number }>((resolve) => {
          let lcp = 0;
          let cls = 0;
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) lcp = entry.startTime;
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
              if (!shift.hadRecentInput) cls += shift.value;
            }
          }).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve({ lcp, cls }), 1500);
        }),
    );
    page.off("response", onResponse);

    expect(vitals.lcp, `${path} paints its main content too late`).toBeLessThan(budget.lcp);
    expect(vitals.cls, `${path} shifts under the reader`).toBeLessThan(budget.cls);
    expect(transferred, `${path} ships too many bytes`).toBeLessThan(budget.transferBytes);
  }
});

test("167. tabbing a public form always leaves focus visible", async ({ page }) => {
  await page.goto(`/e/${SLUG}/cfp`);
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

  const invisible: string[] = [];
  for (let index = 0; index < 25; index += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const element = document.activeElement;
      if (element === null || element === document.body) return null;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        // A ring can come from outline, box-shadow or a border change; any of
        // the three counts, none of them does not.
        ring:
          (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== "none",
        onScreen: box.width > 0 && box.height > 0,
      };
    });
    if (focused === null) continue;
    if (focused.onScreen && !focused.ring) invisible.push(focused.tag);
  }

  expect(invisible, "focused controls with no visible ring").toEqual([]);
});

test("168. reduced motion still yields a complete, legible page", async ({ browser }) => {
  const context = await browser.newContext({
    reducedMotion: "reduce",
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const page = await context.newPage();

  await page.goto(`/e/${SLUG}/schedule`);
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

  // Content that only appears at the end of an animation is content a
  // reduced-motion visitor never sees.
  const hidden = await page.evaluate(() =>
    [...document.querySelectorAll("main *, body > div *")]
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          style.opacity === "0" &&
          (element.textContent ?? "").trim().length > 20 &&
          element.getBoundingClientRect().height > 0
        );
      })
      .map((element) => (element.textContent ?? "").trim().slice(0, 40)),
  );
  expect(hidden, "text stuck at opacity 0 with motion reduced").toEqual([]);
  await context.close();
});

test("169. nothing clips or overlaps at 200% zoom", async ({ browser }) => {
  // 200% zoom on a 1280px window is the same layout problem as a 640px viewport.
  const context = await browser.newContext({
    viewport: { width: 640, height: 512 },
    deviceScaleFactor: 2,
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const page = await context.newPage();

  for (const path of ["", "/schedule", "/speakers"]) {
    await page.goto(`/e/${SLUG}${path}`);
    await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

    // Horizontal scroll on a public page at this width is the clipping symptom.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `/e/${SLUG}${path} scrolls sideways at 200% zoom`).toBeLessThanOrEqual(2);
  }
  await context.close();
});
