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

test("44. every field configured on the form is collected somewhere", async ({
  page,
  request,
}) => {
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

  // The form is a four-step wizard, so "on the page" means across its steps.
  let body = "";
  for (const step of ["You", "Your proposal", "Speakers", "Review and submit"]) {
    const tab = page.getByRole("button", { name: new RegExp(step, "i") }).first();
    if ((await tab.count()) > 0) {
      await tab.click();
      await page.waitForTimeout(400);
    }
    body += await page.locator("body").innerText();
  }

  const haystack = body.toLowerCase();
  const missing = fields.filter((field) => {
    if (conditional.has(field.key)) return false;
    if (haystack.includes(field.label.toLowerCase())) return false;
    // The speaker's own bio is asked on the Speakers step under a shorter
    // label, which is a deliberate call recorded in DECISIONS.md.
    return !haystack.includes(field.label.replace(/^speaker\s+/i, "").toLowerCase());
  });
  expect(missing.map((f) => `${f.label} (${f.type})`), "fields absent from the page").toEqual([]);
});

test("45. the deadline is stated on the page", async ({ page }) => {
  await openForm(page);

  await expect(
    page.getByText(/close|deadline|until|submissions? by/i).first(),
  ).toBeVisible({ timeout: 15_000 });
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

  // The trigger lives on the proposal step, and choice fields render as
  // clickable options rather than a native select.
  await page.getByRole("button", { name: /your proposal/i }).first().click();
  await page.waitForTimeout(500);

  const targetLabel = page.getByText(target!.label, { exact: false });
  const chosen = page.getByRole("button", { name: String(rule!.value), exact: true });
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
  await page.getByRole("button", { name: other!.value, exact: true }).click();
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
      field.type === "number" ? 1 : field.type === "checkbox" ? true : "A sufficiently long answer.";
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
  const original = (await (await request.get(`${API}/v1/events/${event!.id}`, { headers })).json()) as {
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
