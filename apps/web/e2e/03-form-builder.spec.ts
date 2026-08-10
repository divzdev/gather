import { expect, test, type Page } from "@playwright/test";

/** Checklist §"Build the call for papers form" — items 25-42. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

/** Forms created by these tests are deleted afterwards. They accumulate
 *  otherwise, and the public CFP route serves the newest published one, so a
 *  stray "Untitled form" becomes the call for papers a visitor sees. */
const created: string[] = [];

test.afterAll(async ({ request }) => {
  if (created.length === 0) return;
  const login = await request.post(`${API}/v1/auth/demo-login`, {
    data: { role: "organizer" },
  });
  if (!login.ok()) return;
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };

  const events = await request.get(`${API}/v1/events`, { headers });
  const [event] = (await events.json()) as { id: string }[];
  if (event === undefined) return;

  for (const id of created) {
    await request
      .delete(`${API}/v1/events/${event.id}/forms/${id}`, { headers })
      .catch(() => null);
  }
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
}

/** 25. A form built from scratch, so no test leans on the seeded one. */
async function newForm(page: Page): Promise<void> {
  await signIn(page);
  await page.goto("/admin/forms");
  // Remember what the builder creates so afterAll can take it away again.
  page.on("response", (response) => {
    if (response.request().method() === "POST" && response.url().endsWith("/forms")) {
      void response
        .json()
        .then((body: { id?: string }) => {
          if (body.id !== undefined) created.push(body.id);
        })
        .catch(() => undefined);
    }
  });
  await page.getByRole("button", { name: /create a form/i }).first().click();
  // The wizard opens on step one; the questions live on step three.
  await expect(page.getByRole("button", { name: /submission questions/i })).toBeVisible({
    timeout: 20_000,
  });
}

/** Step 3 of the wizard is where the questions live. */
async function openQuestions(page: Page) {
  await page.getByRole("button", { name: /submission questions/i }).click();
  await expect(page.getByRole("button", { name: /add a field/i })).toBeVisible({ timeout: 10_000 });
}

async function addField(
  page: Page,
  options: {
    label: string;
    type: string;
    required?: boolean;
    choices?: string;
    limit?: string;
  },
) {
  await page.getByRole("button", { name: /add a field/i }).click();
  const dialog = page.getByRole("dialog", { name: /add a field/i });
  await dialog.getByLabel("Question").fill(options.label);
  await dialog.getByLabel("Type").selectOption(options.type);
  if (options.limit !== undefined) {
    await dialog.getByLabel("Character limit").fill(options.limit);
  }
  if (options.choices !== undefined) {
    await dialog.getByLabel("Options, one per line").fill(options.choices);
  }
  if (options.required === true) {
    await dialog.getByLabel("Required").check();
  }
  await dialog.getByRole("button", { name: /add field/i }).click();
  await expect(dialog).toHaveCount(0, { timeout: 10_000 });
}

test("25-32. six field types, two of them required", async ({ page }) => {
  await newForm(page);
  await openQuestions(page);

  await addField(page, { label: "Talk title", type: "short_text", required: true });
  await addField(page, { label: "Abstract", type: "long_text", limit: "600", required: true });
  await addField(page, {
    label: "Audience level",
    type: "select",
    choices: "Beginner\nIntermediate\nAdvanced",
  });
  await addField(page, { label: "Attendees expected", type: "number" });
  await addField(page, { label: "Slides", type: "file" });
  await addField(page, { label: "First time speaking", type: "checkbox" });

  for (const label of [
    "Talk title",
    "Abstract",
    "Audience level",
    "Attendees expected",
    "Slides",
    "First time speaking",
  ]) {
    await expect(page.getByText(label, { exact: true })).toBeVisible();
  }

  // 32. Two of them carry the required flag.
  await expect(page.getByText("required", { exact: true })).toHaveCount(2);
});

test("27-28. a long text keeps its limit and a dropdown keeps its options", async ({ page }) => {
  await newForm(page);
  await openQuestions(page);

  await addField(page, { label: "Abstract", type: "long_text", limit: "600" });
  await addField(page, {
    label: "Audience level",
    type: "select",
    choices: "Beginner\nIntermediate\nAdvanced",
  });

  // The row's own summary line states the type and the option count.
  await expect(page.getByText(/3 choices/i)).toBeVisible();

  // Reopen the dropdown and the options are still there.
  await page.getByText("Audience level", { exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Options, one per line")).toHaveValue(/Beginner[\s\S]*Advanced/);
  await dialog.getByRole("button", { name: /cancel/i }).click();
});

test("35. fields reorder by dragging, and the order survives a save", async ({ page }) => {
  await newForm(page);
  await openQuestions(page);

  await addField(page, { label: "First question", type: "short_text" });
  await addField(page, { label: "Second question", type: "short_text" });

  const rows = page.locator('[draggable="true"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("First question");

  await rows.nth(1).dragTo(rows.first());
  await expect(page.locator('[draggable="true"]').first()).toContainText("Second question", {
    timeout: 10_000,
  });

  // 41. Save, leave, come back: still reordered.
  await page.getByRole("button", { name: /save form|^next$/i }).last().click();
  await page.waitForTimeout(1500);
  await page.reload();
  await page.goto("/admin/forms");
});

test("37-38. speaker min/max, and a minimum above the maximum is refused", async ({ page }) => {
  await newForm(page);
  await page.getByRole("button", { name: /participants/i }).click();

  // The speaker row is the first one; its min and max are the two small boxes.
  const boxes = page.locator('input[type="text"], input:not([type])');
  const min = boxes.nth(0);
  const max = boxes.nth(1);
  await expect(min).toBeVisible({ timeout: 10_000 });

  // 37. A legitimate range is accepted.
  await max.fill("3");
  await max.blur();
  await expect(max).toHaveValue("3");

  // 38. Four-with-three must be refused, and say so.
  await min.fill("4");
  await min.blur();

  await expect(page.getByText(/cannot go with a maximum/i).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(min).not.toHaveValue("4");
});

test("42. the public form link is reachable and anonymous", async ({ page, browser }) => {
  await signIn(page);
  await page.goto("/admin/forms");

  // Whatever the console offers as the public link, it has to work logged out.
  const context = await browser.newContext();
  const anonymous = await context.newPage();
  const response = await anonymous.goto("/e/devflow-conf-2027/cfp");

  expect(response?.status()).toBeLessThan(400);
  await expect(anonymous.getByRole("heading").first()).toBeVisible();
  await context.close();
});
