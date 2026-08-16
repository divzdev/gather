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

/** A refusal, which is the path that never reached `done` — so before this was
 *  carried on every terminal event, asking something off-catalogue left the
 *  screen with nothing to say about what had answered. */
const REFUSAL_SSE = [
  "event: planning\ndata: {}",
  'event: model\ndata: {"name": "openai"}',
  'event: refusal\ndata: {"message": "This question cannot be answered by any query in the catalog.", "is_stub": false, "model": "muse-spark-1.2-contributor", "usage": {"input_tokens": 1285, "output_tokens": 319}, "elapsed_ms": 9000}',
].join("\n\n");

const STUB_SSE = [
  "event: planning\ndata: {}",
  'event: queries\ndata: {"names": ["submissions_by"]}',
  'event: token\ndata: {"text": "Sample output — no model is configured."}',
  'event: done\ndata: {"proposal_id": "01a00000-0000-7000-8000-000000000001", "queries": ["submissions_by"], "is_stub": true}',
].join("\n\n");

/** A proposed change. The card is the last thing read before a row exists, so
 *  what it says is the whole safety argument — asserted, not assumed. */
const PROPOSAL_SSE = [
  "event: planning\ndata: {}",
  'event: model\ndata: {"name": "muse-spark-1.2-contributor", "provider": "Meta Muse Spark", "is_stub": false}',
  'event: proposal\ndata: {"proposal_id": "01a00000-0000-7000-8000-00000000000a", "is_stub": false, "model": "muse-spark-1.2-contributor", "usage": {"input_tokens": 900, "output_tokens": 100}, "elapsed_ms": 4000, "actions": [{"index": 0, "name": "create_room", "verb": "create", "resource": "room", "collection": "rooms", "event": "DevFlow Conf 2027", "target": null, "before": {}, "values": {"name": "Big One", "capacity": 60}, "status": "proposed"}]}',
].join("\n\n");

/** Two creates, so Apply-all has something to be about. */
const BATCH_SSE = [
  "event: planning\ndata: {}",
  'event: proposal\ndata: {"proposal_id": "01a00000-0000-7000-8000-00000000000b", "is_stub": false, "actions": [{"index": 0, "name": "create_room", "verb": "create", "resource": "room", "collection": "rooms", "event": "DevFlow Conf 2027", "target": null, "before": {}, "values": {"name": "Big One"}, "status": "proposed"}, {"index": 1, "name": "create_room", "verb": "create", "resource": "room", "collection": "rooms", "event": "DevFlow Conf 2027", "target": null, "before": {}, "values": {"name": "Studio"}, "status": "proposed"}]}',
].join("\n\n");

/** An edit whose target the assistant had to work out. The resolved name on the
 *  card is what makes a wrong resolution catchable by reading (story 22). */
const RESOLVED_SSE = [
  "event: planning\ndata: {}",
  'event: resolving\ndata: {"target": "the big room"}',
  'event: proposal\ndata: {"proposal_id": "01a00000-0000-7000-8000-00000000000c", "is_stub": false, "actions": [{"index": 0, "name": "update_room", "verb": "update", "resource": "room", "collection": "rooms", "event": "DevFlow Conf 2027", "target": "Big One", "before": {"capacity": 60}, "values": {"capacity": 80}, "status": "proposed"}]}',
].join("\n\n");

async function serveApply(
  page: import("@playwright/test").Page,
  results: Record<string, unknown>[],
): Promise<void> {
  await page.route("**/ai/proposals/*/apply", async (route) => {
    await route.fulfill({ status: 200, json: { results } });
  });
}

async function serve(page: import("@playwright/test").Page, body: string): Promise<void> {
  await page.route("**/ai/ask", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: `${body}\n\n`,
    });
  });
}

type Status = {
  provider: string;
  provider_label: string;
  model: string;
  source: string;
  is_stub: boolean;
  used_today: number;
  /** Null is uncapped, which the line has to render differently from zero. */
  daily_cap: number | null;
  ai_disabled: boolean;
};

/** What the drawer reads on open to fill in the line under the composer. Canned
 *  for the same reason the stream is: a developer with a key configured would
 *  otherwise get their own provider's name in the assertion. */
const STATUS: Status = {
  provider: "meta",
  provider_label: "Meta Muse Spark",
  model: "muse-spark-1.2-contributor",
  source: "org",
  is_stub: false,
  used_today: 4,
  daily_cap: 30,
  ai_disabled: false,
};

async function serveStatus(
  page: import("@playwright/test").Page,
  overrides: Partial<Status> = {},
): Promise<void> {
  await page.route("**/ai/status*", async (route) => {
    await route.fulfill({ status: 200, json: { ...STATUS, ...overrides } });
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
    await serveStatus(page);
    await page.goto("/login");
    await page.getByRole("button", { name: /^Organizer$/i }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
    await settle(page);
  });

  test("says which model is answering before a question is asked", async ({ page }) => {
    // The reported bug, twice over: the line existed only after a successful
    // answer, so the person wondering whether their key was in use had to spend
    // a question to find out — and the answer they got back was the wire
    // protocol, not the model.
    await page.locator("[data-console-ask]").click();
    const drawer = page.getByRole("dialog");

    await expect(drawer.locator("[data-assistant-provenance]")).toHaveText(
      "Meta Muse Spark · muse-spark-1.2-contributor · 4/30 today",
    );
  });

  test("an uncapped organisation is not shown a ceiling of zero", async ({ page }) => {
    await serveStatus(page, { daily_cap: null });

    await page.locator("[data-console-ask]").click();

    await expect(page.getByRole("dialog").locator("[data-assistant-provenance]")).toHaveText(
      "Meta Muse Spark · muse-spark-1.2-contributor · 4 today",
    );
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

  test("a refusal still says which model refused, and what it cost", async ({ page }) => {
    await serve(page, REFUSAL_SSE);

    await page.locator("[data-console-ask]").click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("Your question").fill("are you connected?");
    await drawer.getByRole("button", { name: "Ask" }).click();

    await expect(drawer.getByText(/cannot be answered by any query/)).toBeVisible();
    // The line under the composer, now carrying the run: provider, model, the
    // day's spend — which the refusal just moved — and what this one cost.
    await expect(drawer.locator("[data-assistant-provenance]")).toHaveText(
      "Meta Muse Spark · muse-spark-1.2-contributor · 4/30 today · 1,604 tok · 9.0s",
    );
  });

  test("a proposed change is a card, and nothing happens until it is pressed", async ({ page }) => {
    await serve(page, PROPOSAL_SSE);
    let applied = false;
    await page.route("**/ai/proposals/*/apply", async (route) => {
      applied = true;
      await route.fulfill({
        status: 200,
        json: { results: [{ index: 0, status: "applied", id: "01a0", label: "Big One" }] },
      });
    });

    await page.locator("[data-console-ask]").click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("Your question").fill("add a room called Big One with capacity 60");
    await drawer.getByRole("button", { name: "Ask" }).click();

    // The card says what it will do, in words, before anything is pressed.
    const card = drawer.locator("[data-assistant-change]");
    await expect(card).toContainText("Create room");
    await expect(card).toContainText("name Big One");
    await expect(card).toContainText("capacity 60");
    expect(applied, "reading a card must not write a row").toBe(false);

    await card.getByRole("button", { name: "Create" }).click();

    await expect(card).toContainText("Done · Big One");
    await expect(card.getByRole("button", { name: "Create" })).toHaveCount(0);
    expect(applied).toBe(true);
  });

  test("applying refetches the screen the new row belongs on", async ({ page }) => {
    // Story 23 — "the applied row appears without a reload" — which every other
    // test here stubs away. The row itself is not what is asserted: the drawer
    // does not own the rooms list and cannot re-render it, so what has to be
    // true is that it *invalidates* it. Counting the GET is the observable
    // version of that, and it fails if the invalidation is dropped.
    let listed = 0;
    await page.route("**/v1/events/*/rooms**", async (route) => {
      listed += 1;
      await route.fallback();
    });
    await serve(page, PROPOSAL_SSE);
    await serveApply(page, [{ index: 0, status: "applied", id: "01a0", label: "Big One" }]);

    await page.goto("/admin/program/rooms");
    await settle(page);
    await expect.poll(() => listed).toBeGreaterThan(0);
    const before = listed;

    await page.locator("[data-console-ask]").click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("Your question").fill("add a room called Big One");
    await drawer.getByRole("button", { name: "Ask" }).click();
    await drawer.getByRole("button", { name: "Create" }).click();
    await expect(drawer.getByText("Done · Big One")).toBeVisible();

    await expect.poll(() => listed, { timeout: 5_000 }).toBeGreaterThan(before);
  });

  test("an edit shows what the field holds now, not just what it will hold", async ({ page }) => {
    await serve(page, RESOLVED_SSE);

    await page.locator("[data-console-ask]").click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("Your question").fill("make the big room hold 80");
    await drawer.getByRole("button", { name: "Ask" }).click();

    const card = drawer.locator("[data-assistant-change]");
    // Story 22: the row it resolved to is named, so a wrong pick is caught by
    // reading rather than by discovering it later.
    await expect(card).toContainText("Change room");
    await expect(card).toContainText("Big One");
    await expect(card).toContainText("60");
    await expect(card).toContainText("80");
  });

  test("three changes can be applied together or one at a time", async ({ page }) => {
    await serve(page, BATCH_SSE);
    await serveApply(page, [
      { index: 0, status: "applied", id: "01a0", label: "Big One" },
      { index: 1, status: "applied", id: "01a1", label: "Studio" },
    ]);

    await page.locator("[data-console-ask]").click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("Your question").fill("add rooms Big One and Studio");
    await drawer.getByRole("button", { name: "Ask" }).click();

    await expect(drawer.locator("[data-assistant-change]")).toHaveCount(2);
    await drawer.getByRole("button", { name: "Create all 2" }).click();

    await expect(drawer.getByText("Done · Big One")).toBeVisible();
    await expect(drawer.getByText("Done · Studio")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Create all 2" })).toHaveCount(0);
  });

  test("a change that fails says why and leaves its siblings alone", async ({ page }) => {
    await serve(page, BATCH_SSE);
    await serveApply(page, [
      { index: 0, status: "applied", id: "01a0", label: "Big One" },
      {
        index: 1,
        status: "failed",
        error: "This event already has a room with that name.",
      },
    ]);

    await page.locator("[data-console-ask]").click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("Your question").fill("add rooms Big One and Studio");
    await drawer.getByRole("button", { name: "Ask" }).click();
    await drawer.getByRole("button", { name: "Create all 2" }).click();

    await expect(drawer.getByText("Done · Big One")).toBeVisible();
    await expect(drawer.getByText("This event already has a room with that name.")).toBeVisible();
    // Story 6: the failure keeps its own button, and only its own.
    await expect(drawer.getByRole("button", { name: "Try again" })).toHaveCount(1);
  });

  test("discarding stops the cards being pressable", async ({ page }) => {
    await serve(page, PROPOSAL_SSE);
    let discarded = false;
    await page.route("**/ai/proposals/*/discard", async (route) => {
      discarded = true;
      await route.fulfill({ status: 200, json: {} });
    });

    await page.locator("[data-console-ask]").click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("Your question").fill("add a room called Big One");
    await drawer.getByRole("button", { name: "Ask" }).click();
    await drawer.getByRole("button", { name: /^Discard/ }).click();

    await expect(drawer.getByText("Discarded — nothing was changed.")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Create" })).toHaveCount(0);
    expect(discarded).toBe(true);
  });

  test("a discard that fails leaves the changes pressable and says so", async ({ page }) => {
    // Both review axes found this independently: the handler swallowed the
    // failure and marked the card discarded anyway, so the screen claimed
    // nothing had changed while the proposal stayed fully appliable.
    await serve(page, PROPOSAL_SSE);
    await page.route("**/ai/proposals/*/discard", async (route) => {
      await route.fulfill({
        status: 500,
        json: { error: { code: "BOOM", message: "The server could not do that." } },
      });
    });

    await page.locator("[data-console-ask]").click();
    const drawer = page.getByRole("dialog");
    await drawer.getByLabel("Your question").fill("add a room called Big One");
    await drawer.getByRole("button", { name: "Ask" }).click();
    await drawer.getByRole("button", { name: /^Discard/ }).click();

    await expect(drawer.getByText(/have not been discarded/)).toBeVisible();
    await expect(drawer.getByText("Discarded — nothing was changed.")).toHaveCount(0);
    // The claim that matters: it is still pressable, because it is still real.
    await expect(drawer.getByRole("button", { name: "Create" })).toBeVisible();
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
