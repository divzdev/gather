import { expect, test } from "@playwright/test";

/** The event assistant, from the header to a rendered answer (spec 0005).
 *
 *  The stream is intercepted rather than served by the API, and that is the
 *  point rather than a shortcut. The server half is already covered at its own
 *  seam in `test_ai_assistant.py`; what no Python test can reach is the
 *  browser's SSE parsing and what it draws. Serving a canned stream here also
 *  makes the test say the same thing on every machine — a developer with Ollama
 *  running gets a real model on this route, and asserting on model-written
 *  English would be a flake generator.
 */

const SSE = [
  "event: planning\ndata: {}",
  'event: queries\ndata: {"names": ["tasks_outstanding"]}',
  'event: token\ndata: {"text": "Two speakers still owe a headshot: "}',
  'event: token\ndata: {"text": "Priya Raman and Tom Okafor."}',
  'event: done\ndata: {"proposal_id": "01a00000-0000-7000-8000-000000000000", "queries": ["tasks_outstanding"], "is_stub": false}',
].join("\n\n");

const STUB_SSE = [
  "event: planning\ndata: {}",
  'event: queries\ndata: {"names": ["submissions_by"]}',
  'event: token\ndata: {"text": "Sample output — no model is configured."}',
  'event: done\ndata: {"proposal_id": "01a00000-0000-7000-8000-000000000001", "queries": ["submissions_by"], "is_stub": true}',
].join("\n\n");

async function serve(page: import("@playwright/test").Page, body: string): Promise<void> {
  await page.route("**/ai/ask", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `${body}\n\n`,
    });
  });
}

/** The event switcher loads its name asynchronously and the header is a flex
 *  row, so clicking before it settles races a layout that is still moving —
 *  which is exactly how this spec failed twice before the wait went in. Same
 *  guard `24-console-header.spec.ts` uses, for the same reason. */
async function settle(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator('[aria-label="Switch event"]')).not.toContainText("Loading", {
    timeout: 20_000,
  });
}

test.describe("event assistant", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: /^Organizer$/i }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
    await settle(page);
  });

  test("asks from the header and renders the answer with what it looked at", async ({ page }) => {
    await serve(page, SSE);

    await page.locator("[data-console-ask]").click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();

    await drawer.getByLabel("Your question").fill("who still owes me a headshot");
    await drawer.getByRole("button", { name: "Ask" }).click();

    // The question is echoed, so the transcript reads as a conversation rather
    // than as a field that emptied itself.
    await expect(drawer.getByText("who still owes me a headshot")).toBeVisible();
    await expect(
      drawer.getByText("Two speakers still owe a headshot: Priya Raman and Tom Okafor."),
    ).toBeVisible();
    // The whole trust argument of the feature is visible here: it says what it
    // read before it answered.
    await expect(drawer.getByText(/Looked at outstanding tasks/)).toBeVisible();
    await expect(drawer.getByText(/no model is configured/i)).toHaveCount(0);
  });

  test("an answer with no model behind it says so", async ({ page }) => {
    await serve(page, STUB_SSE);

    await page.locator("[data-console-ask]").click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("Your question").fill("how many submissions did we get");
    await drawer.getByRole("button", { name: "Ask" }).click();

    await expect(drawer.getByText(/Sample answer — no model ran/)).toBeVisible();
  });

  test("the palette hands a typed question to the assistant", async ({ page }) => {
    await serve(page, SSE);

    // The header control rather than ⌘K: the shortcut is the browser's to
    // swallow on some platforms, and this is the same entry point either way.
    await page.locator("[data-console-search]").click();
    await page
      .getByPlaceholder("Jump to a screen, a proposal, or a speaker")
      .fill("who owes me a headshot");
    await page.getByText("Ask: who owes me a headshot").click();

    // Seeded, not sent: the palette hands the question over, and the person
    // still presses Ask. A palette that fired a question off on Enter would be
    // spending money on a keystroke meant to navigate.
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByLabel("Your question")).toHaveValue("who owes me a headshot");
  });
});
