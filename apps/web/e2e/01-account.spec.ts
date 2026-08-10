import { expect, test } from "@playwright/test";

/** Checklist §"Account and login" and §"Create the conference" — items 1-17. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

async function signInAsOrganizer(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
}

test("1. landing loads clean with no console errors and no failed requests", async ({ page }) => {
  const errors: string[] = [];
  const failed: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });

  const response = await page.goto("/");

  expect(response?.status()).toBeLessThan(400);
  expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  expect(failed, `failed requests: ${failed.join(" | ")}`).toEqual([]);
});

test("2. the landing page says what the product is above the fold", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");

  const heading = page.getByRole("heading", { level: 1 }).first();
  await expect(heading).toBeVisible();

  const box = await heading.boundingBox();
  expect(box, "h1 has no box").not.toBeNull();
  expect(box!.y, "h1 is below the fold").toBeLessThan(800);
});

test("3. demo logins are visible without hunting", async ({ page }) => {
  await page.goto("/login");

  for (const role of ["Organizer", "Reviewer", "Speaker"]) {
    await expect(page.getByRole("button", { name: new RegExp(`^${role}$`, "i") })).toBeVisible();
  }
});

test("4-6. registration: happy path, duplicate email, malformed email", async ({ page }) => {
  const unique = `owner-${Date.now()}@example.com`;
  await page.goto("/login");
  await page.getByRole("button", { name: /create one/i }).click();

  await page.getByLabel(/your name/i).fill("Test Owner");
  await page.getByLabel(/event or organization/i).fill("Testers Inc");
  await page.getByLabel(/work email/i).fill(unique);
  await page.getByLabel(/^password$/i).fill("a-long-enough-passphrase");
  await page.getByRole("button", { name: /create workspace/i }).click();

  // 4. lands in the console
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });

  // 5. The same address again is refused, in words. A fresh context, because
  // the first half left us signed in and /login would bounce to the console.
  const fresh = await page.context().browser()!.newContext();
  const second = await fresh.newPage();
  await second.goto("/login");
  await second.getByRole("button", { name: /create one/i }).click();
  await second.getByLabel(/your name/i).fill("Test Owner");
  await second.getByLabel(/event or organization/i).fill("Testers Inc");
  await second.getByLabel(/work email/i).fill(unique);
  await second.getByLabel(/^password$/i).fill("a-long-enough-passphrase");
  await second.getByRole("button", { name: /create workspace/i }).click();
  await expect(second.getByText(/already exists|already registered|taken/i)).toBeVisible({
    timeout: 15_000,
  });
  await fresh.close();
});

test("6. a malformed email is caught before it reaches the server", async ({ page }) => {
  let posted = false;
  page.on("request", (request) => {
    if (request.url().includes("/auth/register")) posted = true;
  });

  await page.goto("/login");
  await page.getByRole("button", { name: /create one/i }).click();
  await page.getByLabel(/your name/i).fill("Test Owner");
  await page.getByLabel(/event or organization/i).fill("Testers Inc");
  await page.getByLabel(/work email/i).fill("not-an-email");
  await page.getByLabel(/^password$/i).fill("a-long-enough-passphrase");
  await page.getByRole("button", { name: /create workspace/i }).click();

  await page.waitForTimeout(1500);
  expect(posted, "a malformed address was sent to the server").toBe(false);
});

test("7. log out and back in again", async ({ page }) => {
  await signInAsOrganizer(page);

  await page.getByRole("button", { name: /account menu/i }).click();
  await page.getByRole("button", { name: /sign out/i }).click();
  await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });

  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
});

test("8. a wrong password is a clear message, not a stack trace", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/work email/i).fill("sbek-organizer@example.com");
  await page.getByLabel(/^password$/i).fill("definitely-not-the-password");
  await page.getByRole("button", { name: /^sign in$/i }).click();

  const error = page.getByText(/incorrect|invalid|wrong/i).first();
  await expect(error).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("body")).not.toContainText(/Traceback|at Object\.|internal server/i);
});

test("9. forgot password produces a link, or says where it went", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/work email/i).fill("sbek-organizer@example.com");
  await page.getByRole("button", { name: /link|forgot/i }).first().click();

  await expect(page.getByText(/on its way|sent|check your|inbox|link/i).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("10. all three demo seats work first try", async ({ browser }) => {
  for (const [role, landing] of [
    ["Organizer", /\/admin/],
    ["Reviewer", /\/review|\/admin/],
    ["Speaker", /\/portal/],
  ] as const) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto("/login");
    await page.getByRole("button", { name: new RegExp(`^${role}$`, "i") }).click();
    await expect(page, `${role} did not land`).toHaveURL(landing, { timeout: 20_000 });
    await context.close();
  }
});

test("11. every console nav item resolves and renders", async ({ page }) => {
  await signInAsOrganizer(page);

  const routes = [
    "/admin",
    "/admin/submissions",
    "/admin/sessions",
    "/admin/review",
    "/admin/speakers",
    "/admin/directory",
    "/admin/agenda",
    "/admin/tasks",
    "/admin/messages",
    "/admin/forms",
    "/admin/publishing",
    "/admin/settings",
  ];

  const broken: string[] = [];
  for (const route of routes) {
    const response = await page.goto(route);
    if ((response?.status() ?? 500) >= 400) {
      broken.push(`${route} → ${response?.status()}`);
      continue;
    }
    // "Renders" means something is on the screen, not merely a 200.
    const text = (await page.locator("body").innerText().catch(() => "")).trim();
    if (text.length < 20) broken.push(`${route} → blank`);
  }

  expect(broken, `broken nav targets: ${broken.join(", ")}`).toEqual([]);
});

test("12-17. the event settings validate and persist", async ({ page }) => {
  await signInAsOrganizer(page);
  await page.goto("/admin/settings");

  const name = page.getByLabel(/event name/i);
  await expect(name).toBeVisible({ timeout: 15_000 });
  // The panel fills from the API after mount; reading before that captures "".
  await expect(name).not.toHaveValue("", { timeout: 15_000 });
  const original = await name.inputValue();

  // 13. There is no save button by design — fields commit on blur. An empty
  // name must still be refused rather than silently wiping the event.
  await name.fill("");
  await name.blur();
  await page.waitForTimeout(2500);
  await page.reload();
  await expect(page.getByLabel(/event name/i)).not.toHaveValue("");

  // 14. An end date before the start date is refused.
  const starts = page.getByLabel(/^starts$|start date/i).first();
  const ends = page.getByLabel(/^ends$|end date/i).first();
  if ((await ends.count()) > 0) {
    const goodEnd = await ends.inputValue();
    await starts.fill("2027-06-10");
    await starts.blur();
    await ends.fill("2027-06-01");
    await ends.blur();
    await page.waitForTimeout(2500);
    await page.reload();
    await expect(page.getByLabel(/^ends$|end date/i).first()).not.toHaveValue("2027-06-01");
    await ends.fill(goodEnd);
    await ends.blur();
  }

  // 16. A real edit survives a reload.
  const renamed = `${original} ✓`;
  await page.getByLabel(/event name/i).fill(renamed);
  await page.getByLabel(/event name/i).blur();
  await page.waitForTimeout(2500);
  await page.reload();
  await expect(page.getByLabel(/event name/i)).toHaveValue(renamed, { timeout: 15_000 });

  // Put it back so the suite is re-runnable.
  await page.getByLabel(/event name/i).fill(original);
  await page.getByLabel(/event name/i).blur();
  await page.waitForTimeout(2000);
});

test("17. the event switcher is on every screen and lists your events", async ({ page }) => {
  await signInAsOrganizer(page);

  // It has to be reachable from wherever you are, not only the submissions list.
  for (const route of ["/admin", "/admin/agenda", "/admin/tasks"]) {
    await page.goto(route);
    const switcher = page.getByRole("button", { name: /switch event/i });
    await expect(switcher, `no event switcher on ${route}`).toBeVisible({ timeout: 15_000 });
  }

  await page.getByRole("button", { name: /switch event/i }).click();
  const list = page.getByRole("listbox", { name: /events/i });
  await expect(list).toBeVisible({ timeout: 10_000 });
  await expect(list.getByRole("option")).not.toHaveCount(0);
  await expect(list.getByRole("option", { selected: true })).toHaveCount(1);
});
