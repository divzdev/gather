import { expect, test, type Page } from "@playwright/test";

/** Checklist §"Submit as a stranger" — items 43-63.
 *
 *  Every test here runs in a fresh, never-authenticated context. That is the
 *  point of the section: a stranger with a link and no account.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
const SLUG = "devflow-conf-2027";

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

/** Answer whatever the current step is showing, generically.
 *
 *  Generic on purpose: this file's point is that the *schema* decides what the
 *  form asks, so a helper that knew the field names would be asserting the same
 *  hard-coded list the test exists to stop trusting.
 *
 *  There is no `<form>` element and no `required` attribute — the CFP marks a
 *  required question with an asterisk in its label and validates in React — so
 *  this fills every visible control rather than selecting on `[required]`. */
async function fillVisibleControls(page: Page) {
  const controls = page.locator("input, textarea, select");
  for (let index = 0; index < (await controls.count()); index += 1) {
    const control = controls.nth(index);
    if (!(await control.isVisible().catch(() => false))) continue;
    const tag = await control.evaluate((node) => node.tagName.toLowerCase());

    if (tag === "select") {
      const values = await control
        .locator("option")
        .evaluateAll((options) =>
          options
            .map((option) => (option as HTMLOptionElement).value)
            .filter((value) => value !== ""),
        );
      if (values.length > 0) await control.selectOption(values[0]!).catch(() => undefined);
      continue;
    }

    const type = (await control.getAttribute("type")) ?? "text";
    if (type === "checkbox" || type === "radio") {
      await control.check().catch(() => undefined);
      continue;
    }
    if (type === "file" || (await control.inputValue().catch(() => "x")) !== "") continue;
    await control
      .fill(
        type === "email"
          ? "walker@example.com"
          : type === "url"
            ? "https://example.com/walker"
            : "Filled by the E2E walk so the wizard will advance",
      )
      .catch(() => undefined);
  }

  // Choice questions are not `<select>` or `<input type=radio>` — they are
  // buttons carrying the ARIA role, which is why a walker that only knew about
  // form controls sat on the proposal step forever being told to pick a track.
  const groups = page.locator('[role="radiogroup"], [role="group"]');
  for (let index = 0; index < (await groups.count()); index += 1) {
    const group = groups.nth(index);
    if (!(await group.isVisible().catch(() => false))) continue;
    const already = await group.locator('[aria-checked="true"]').count();
    if (already > 0) continue;
    const option = group.locator('[role="radio"], [role="checkbox"]').first();
    if ((await option.count()) > 0) await option.click().catch(() => undefined);
  }
}

async function openForm(page: Page) {
  const response = await page.goto(`/e/${SLUG}/cfp`);
  expect(response?.status()).toBeLessThan(400);
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
}

test("43. the form opens with no login and sends no credentials", async ({ page }) => {
  let sentAuth = false;
  page.on("request", (request) => {
    if (request.headers()["authorization"] !== undefined) sentAuth = true;
  });

  await openForm(page);

  expect(sentAuth, "the public form sent an Authorization header").toBe(false);
  expect(await page.context().cookies()).toEqual([]);
});

// This file's tests read whatever CFP form the public route serves, and the
// route deliberately serves the newest open one — so anything 03-form-builder
// leaves behind on the shared seeded event (its cleanup swallows delete
// failures, e.g. a form that locked itself by collecting a submission) changes
// what these assertions see. The suite runs single-worker, so this is leftover
// state, not a race. The durable fix is 03 building against its own event;
// until then the config-level retry absorbs it, and a real regression still
// fails twice.

/** The form promised "saved as you go" unconditionally, against a 20-second
 *  timer with no flush on the way out. Someone who typed two fields and left at
 *  second nineteen lost all of it, having just been told they would not. Both
 *  halves are pinned: the sentence has to match the state, and leaving has to
 *  save. */
test("the CFP does not promise a save it has not made, and saves on the way out", async ({
  page,
}) => {
  await openForm(page);

  const promise = page.getByText(/saving itself|saved as you go/);
  await expect(promise, "the form made no claim about saving at all").toBeVisible();
  await expect(
    promise,
    "the form promised work was already saved before anything had been",
  ).toHaveText(/starts saving itself/);

  await page.getByLabel(/Your name/i).fill("Exit Flush");
  await page.getByLabel(/Email/i).fill("exit.flush@conference.org");
  await page.getByRole("button", { name: /Continue/i }).click();
  await page.getByLabel(/Session title/i).fill("Leaving early should not lose this");

  // Well inside AUTOSAVE_MS, so a pass here cannot come from the interval.
  await expect(page.getByText(/Not saved yet/)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

  await expect(page.getByText(/^Saved /), "leaving the page did not flush the draft").toBeVisible({
    timeout: 10_000,
  });
});

test("44. every field configured on the form is collected somewhere", async ({ page, request }) => {
  // The schema is the source of truth: whatever the organiser configured has to
  // render, not a fixed set the page happens to know about.
  const payload = await request.get(`${API}/v1/public/events/${SLUG}/cfp-form`);
  const schema = (await payload.json()) as {
    schema: {
      logic: { target: string }[];
      sections: { fields: { key: string; label: string; type: string }[] }[];
    };
  };
  const fields = schema.schema.sections.flatMap((section) => section.fields);
  expect(fields.length, "the seeded form has no fields").toBeGreaterThan(3);

  // A conditional field is meant to be absent until its trigger is set; that is
  // asserted separately in 49-50.
  const conditional = new Set(schema.schema.logic.map((rule) => rule.target));

  await openForm(page);

  // The form is a wizard, so "on the page" means across its steps — and the
  // steps are walked the way a speaker walks them. Clicking the numbered step
  // buttons does not work and should not: you cannot jump over a step whose
  // required fields are empty. This test used to click them anyway, never left
  // step one, and so reported every field on every later step as missing.
  // Wait for the wizard itself, not just the first heading `openForm` waits on.
  // The heading is server-rendered and Continue is not, so counting the button
  // straight away found nothing, broke the walk on its first pass, and reported
  // every field beyond step one as missing.
  const firstNext = page.getByRole("button", { name: /^Continue$/i });
  await expect(firstNext, "the CFP wizard never rendered").toBeVisible({ timeout: 20_000 });

  let body = await page.locator("body").innerText();
  for (let step = 0; step < 8; step += 1) {
    const next = page.getByRole("button", { name: /^Continue$/i });
    if ((await next.count()) === 0) break;

    // Fill whatever this step is asking for before asking to leave it.
    await fillVisibleControls(page);
    await next.click();
    await page.waitForTimeout(400);
    const now = await page.locator("body").innerText();
    if (now === body) break;
    body += now;
  }

  const haystack = body.toLowerCase();
  const missing = fields.filter((field) => {
    if (conditional.has(field.key)) return false;
    if (haystack.includes(field.label.toLowerCase())) return false;
    // The speaker's own bio is asked on the Speakers step under a shorter
    // label, which is a deliberate call recorded in DECISIONS.md.
    return !haystack.includes(field.label.replace(/^speaker\s+/i, "").toLowerCase());
  });
  expect(
    missing.map((f) => `${f.label} (${f.type})`),
    "fields absent from the page",
  ).toEqual([]);
});

test("45. the deadline is stated on the page", async ({ page }) => {
  await openForm(page);

  await expect(page.getByText(/close|deadline|until|submissions? by/i).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("46. a required field left empty blocks the submit and says which", async ({ page }) => {
  await openForm(page);

  // Walk to the last step and try to submit with nothing filled in.
  for (let index = 0; index < 6; index += 1) {
    const next = page.getByRole("button", { name: /^next$|continue/i }).first();
    if ((await next.count()) === 0) break;
    await next.click();
    await page.waitForTimeout(300);
  }

  const submit = page.getByRole("button", { name: /submit|send proposal/i }).first();
  if ((await submit.count()) > 0) await submit.click();

  await expect(page.getByText(/required|needed|cannot be empty|fill/i).first()).toBeVisible({
    timeout: 10_000,
  });
});

test("49-50. a conditional field appears and hides with its trigger", async ({ page, request }) => {
  const payload = await request.get(`${API}/v1/public/events/${SLUG}/cfp-form`);
  const schema = (await payload.json()) as {
    schema: {
      logic: { field: string; value: unknown; target: string; action: string }[];
      sections: { fields: { key: string; label: string; choices: { value: string }[] }[] }[];
    };
  };
  const rule = schema.schema.logic[0];
  test.skip(rule === undefined, "the seeded form has no conditional rule");

  const fields = schema.schema.sections.flatMap((section) => section.fields);
  const trigger = fields.find((field) => field.key === rule!.field);
  const target = fields.find((field) => field.key === rule!.target);
  expect(trigger, "logic references a field that is not on the form").toBeDefined();
  expect(target).toBeDefined();

  await openForm(page);

  // The trigger lives on the proposal step. Choice fields render as pills
  // rather than a native select, and each pill carries an explicit role="radio"
  // inside a labelled radiogroup — which *overrides* the implicit button role,
  // so querying for a button finds nothing at all.
  await page
    .getByRole("button", { name: /your proposal/i })
    .first()
    .click();
  await page.waitForTimeout(500);

  const targetLabel = page.getByText(target!.label, { exact: false });
  const chosen = page.getByRole("radio", { name: String(rule!.value), exact: true });
  await expect(chosen, "the trigger option is not on the proposal step").toBeVisible({
    timeout: 10_000,
  });

  // 49. Before the trigger is picked, the dependent question is not asked.
  await expect(targetLabel).toHaveCount(0);
  await chosen.click();
  await expect(targetLabel.first()).toBeVisible({ timeout: 10_000 });

  // 50. And it hides again when the trigger changes.
  const other = trigger!.choices.find((choice) => choice.value !== String(rule!.value));
  expect(other, "the trigger has only one option, so it cannot be changed back").toBeDefined();
  await page.getByRole("radio", { name: other!.value, exact: true }).click();
  await expect(targetLabel).toHaveCount(0, { timeout: 10_000 });
});

test("57-59. a proposal submits, returns a code, and the code shows a status", async ({
  request,
}) => {
  // Driven through the API rather than the wizard: this asserts the contract the
  // page depends on, and the wizard's own path is covered by 43-50.
  const payload = await request.get(`${API}/v1/public/events/${SLUG}/cfp-form`);
  const form = (await payload.json()) as {
    form_id: string;
    schema: {
      sections: {
        fields: {
          key: string;
          type: string;
          required: boolean;
          choices: { value: string }[];
        }[];
      }[];
    };
  };
  const fields = form.schema.sections.flatMap((section) => section.fields);
  const answers: Record<string, unknown> = {};
  for (const field of fields.filter((entry) => entry.required)) {
    // A dropdown only accepts one of its own options, which is the whole point
    // of configuring them — so answer with a real one.
    if (field.choices.length > 0) {
      answers[field.key] = field.choices[0]!.value;
      continue;
    }
    answers[field.key] =
      field.type === "number"
        ? 1
        : field.type === "checkbox"
          ? true
          : "A sufficiently long answer.";
  }

  const submitted = await request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
    data: {
      form_id: form.form_id,
      title: `Playwright proposal ${Date.now()}`,
      answers,
      speaker_email: `stranger-${Date.now()}@example.com`,
      speaker_name: "A Stranger",
    },
  });

  expect(submitted.status(), await submitted.text()).toBe(201);
  const { code } = (await submitted.json()) as { code: string };
  expect(code).toHaveLength(6);

  // 59. The code is a lookup key, and it must never leak review data.
  const status = await request.get(`${API}/v1/public/events/${SLUG}/submissions/${code}/status`);
  expect(status.status()).toBe(200);
  const raw = await status.text();
  // The public payload speaks its own vocabulary — stage and outcome — rather
  // than exposing the internal status column.
  expect(raw).toMatch(/stage/i);
  expect(raw, "the public status leaked review data").not.toMatch(
    /score|review|reviewer|comment|rating/i,
  );
});

test("61-62. a closed call for papers refuses and explains itself", async ({ page, request }) => {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const [event] = (await events.json()) as { id: string }[];
  const original = (await (
    await request.get(`${API}/v1/events/${event!.id}`, { headers })
  ).json()) as {
    cfp_closes_at: string | null;
  };

  // Yesterday, as the checklist says — not an arbitrary past date. The API
  // rightly refuses a close date earlier than the CFP's own opening.
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const closed = await request.patch(`${API}/v1/events/${event!.id}`, {
    headers,
    data: { cfp_closes_at: yesterday },
  });
  expect(closed.status(), await closed.text()).toBeLessThan(300);

  try {
    await page.goto(`/e/${SLUG}/cfp`);
    await expect(page.getByText(/closed|no longer accepting|has ended/i).first()).toBeVisible({
      timeout: 15_000,
    });
    // And the API refuses too, not just the page.
    const blocked = await request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
      data: {
        form_id: "00000000-0000-0000-0000-000000000000",
        title: "Too late",
        answers: {},
        speaker_email: "late@example.com",
        speaker_name: "Late",
      },
    });
    expect(blocked.status()).toBeGreaterThanOrEqual(400);
  } finally {
    // 63. Put the window back, or every later run sees a closed CFP.
    await request.patch(`${API}/v1/events/${event!.id}`, {
      headers,
      data: { cfp_closes_at: original.cfp_closes_at },
    });
  }
});

test("a submitter finds their proposal by code and corrects it while the call is open", async ({
  page,
  request,
}) => {
  const form = await request.get(`${API}/v1/public/events/${SLUG}/cfp-form`);
  const { form_id } = (await form.json()) as { form_id: string };
  const body = {
    form_id,
    title: `E2E edit ${Date.now()}`,
    answers: {
      title: `E2E edit ${Date.now()}`,
      abstract: "An abstract long enough to satisfy the validator, with several words in it.",
      track: "AI Engineering",
      format: "Talk (30 min)",
      speaker_bio: "Short bio.",
      key_takeaway: "One sentence worth remembering.",
    },
    speaker_email: `e2e-edit-${Date.now()}@example.com`,
    speaker_name: "Edie Torres",
  };
  const draft = await request.post(`${API}/v1/public/events/${SLUG}/submissions/draft`, {
    data: body,
  });
  const token = ((await draft.json()) as { draft_token: string }).draft_token;
  const submitted = await request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
    data: { ...body, draft_token: token },
  });
  expect(submitted.status(), await submitted.text()).toBe(201);
  const code = ((await submitted.json()) as { code: string }).code;

  // The link the confirmation email carries. The code alone gets the status;
  // the token is what makes the form appear.
  await page.goto(`/e/${SLUG}/submissions/${code}?t=${token}`);
  await expect(page.getByRole("heading", { name: body.title })).toBeVisible({ timeout: 20_000 });

  const title = page.getByLabel(/Session title/i);
  await title.fill("Corrected after submitting");
  await page.getByRole("button", { name: /Save changes/i }).click();
  await expect(page.getByText(/Saved\./i)).toBeVisible({ timeout: 10_000 });

  const after = await request.get(`${API}/v1/public/events/${SLUG}/submissions/${code}/status`);
  expect(((await after.json()) as { title: string }).title).toBe("Corrected after submitting");

  // Without the token there is a status and no form — a code is a lookup key,
  // not a credential.
  await page.goto(`/e/${SLUG}/submissions/${code}`);
  await expect(page.getByText(/confirmation email/i)).toBeVisible({ timeout: 15_000 });
});
