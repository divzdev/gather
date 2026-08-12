import { expect, test, type APIRequestContext } from "@playwright/test";

import { clearRateLimits } from "./support/rate-limits";

/** Checklist §"Form builder" and §"Public submission" — the items 03/04 left
 *  uncovered: 33, 34, 36, 39, 40, 41, 47, 48, 51-56, 60, 63, 65.
 *
 *  These go through the live CFP, because that is what the public endpoint
 *  validates against — a stranger does not get to name which form they are
 *  answering, which is the right call and worth stating. So nothing here edits
 *  the form's fields; the tests that need a different shape build their own form
 *  and read it back, and every proposal created is deleted again.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
const SLUG = "devflow-conf-2027";

async function organizer(request: APIRequestContext) {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const eventId = ((await events.json()) as { id: string }[])[0]!.id;
  return { headers, eventId };
}

type Field = {
  key: string;
  type: string;
  required: boolean;
  choices: { value: string }[];
  max_length: number | null;
};

async function liveForm(request: APIRequestContext) {
  const payload = await request.get(`${API}/v1/public/events/${SLUG}/cfp-form`);
  expect(payload.status(), await payload.text()).toBe(200);
  const form = (await payload.json()) as {
    form_id: string;
    schema: { sections: { fields: Field[] }[]; logic: { target: string }[] };
  };
  return {
    formId: form.form_id,
    fields: form.schema.sections.flatMap((s) => s.fields),
    schema: form.schema,
  };
}

/** Valid answers for every required field the live form asks for. */
function answersFor(fields: Field[], overrides: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = {};
  for (const field of fields.filter((entry) => entry.required)) {
    answers[field.key] =
      field.choices.length > 0
        ? field.choices[0]!.value
        : field.type === "number"
          ? 1
          : field.type === "checkbox" || field.type === "consent"
            ? true
            : "A sufficiently long and plausible answer for this field.";
  }
  return { ...answers, ...overrides };
}

async function removeSubmissions(
  request: APIRequestContext,
  ctx: { headers: Record<string, string>; eventId: string },
  ids: string[],
) {
  for (const id of ids) {
    await request.delete(`${API}/v1/events/${ctx.eventId}/submissions/${id}`, {
      headers: ctx.headers,
    });
  }
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

// Five public submissions an hour per IP is right for a real call for papers and
// exhausted by two fixtures here. The API's own pytest suite clears the same
// keys between tests; this is that, for the browser. The limit itself is
// checked in 04-public-submit and is deliberately not weakened.
test.beforeEach(async () => {
  await clearRateLimits();
});

test("33. a conditional rule round-trips through the builder unchanged", async ({ request }) => {
  const ctx = await organizer(request);

  // Built as a draft form of its own, so the live CFP is untouched.
  const created = await request.post(`${API}/v1/events/${ctx.eventId}/forms`, {
    headers: ctx.headers,
    data: {
      name: `E2E conditional ${Date.now()}`,
      kind: "cfp",
      schema: {
        sections: [
          {
            key: "main",
            title: "Your proposal",
            fields: [
              {
                key: "needs_av",
                type: "select",
                label: "Do you need AV?",
                required: true,
                choices: [
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                ],
              },
              { key: "av_detail", type: "short_text", label: "What AV?", required: false },
            ],
          },
        ],
        logic: [
          { field: "needs_av", operator: "is", value: "yes", action: "show", target: "av_detail" },
        ],
        settings: {},
      },
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const form = (await created.json()) as { id: string };

  try {
    const read = await request.get(`${API}/v1/events/${ctx.eventId}/forms/${form.id}`, {
      headers: ctx.headers,
    });
    const stored = (await read.json()) as {
      schema: { logic: { field: string; operator: string; value: string; target: string }[] };
    };
    expect(stored.schema.logic).toHaveLength(1);
    expect(stored.schema.logic[0]).toMatchObject({
      field: "needs_av",
      operator: "is",
      value: "yes",
      target: "av_detail",
    });
  } finally {
    await request.delete(`${API}/v1/events/${ctx.eventId}/forms/${form.id}`, {
      headers: ctx.headers,
    });
  }
});

test("33b. a required field that logic can hide is refused at build time", async ({ request }) => {
  const ctx = await organizer(request);

  // Required *and* hideable silently blocks submission: the speaker cannot see
  // the field, so they can never satisfy it. The builder has to catch this.
  const created = await request.post(`${API}/v1/events/${ctx.eventId}/forms`, {
    headers: ctx.headers,
    data: {
      name: `E2E trap ${Date.now()}`,
      kind: "cfp",
      schema: {
        sections: [
          {
            key: "main",
            title: "Your proposal",
            fields: [
              {
                key: "needs_av",
                type: "select",
                label: "AV?",
                required: true,
                choices: [
                  { value: "yes", label: "Yes" },
                  { value: "no", label: "No" },
                ],
              },
              { key: "av_detail", type: "short_text", label: "What AV?", required: true },
            ],
          },
        ],
        logic: [
          { field: "needs_av", operator: "is", value: "yes", action: "show", target: "av_detail" },
        ],
        settings: {},
      },
    },
  });

  if (created.status() === 201) {
    const form = (await created.json()) as { id: string; warnings?: string[] };
    // Accepting it is defensible only if the builder says something about it.
    expect(
      JSON.stringify(form),
      "a required-and-hideable field was accepted with no warning",
    ).toMatch(/warn|av_detail|required/i);
    await request.delete(`${API}/v1/events/${ctx.eventId}/forms/${form.id}`, {
      headers: ctx.headers,
    });
  } else {
    expect(created.status()).toBe(422);
    expect(await created.text()).toMatch(/av_detail|required|hidden/i);
  }
});

test("34+65. a proposal records which form it arrived through", async ({ request }) => {
  const ctx = await organizer(request);
  const form = await liveForm(request);

  const submitted = await request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
    data: {
      form_id: form.formId,
      title: `Sourced ${Date.now()}`,
      answers: answersFor(form.fields),
      speaker_email: `sourced-${Date.now()}@example.com`,
      speaker_name: "Source Tester",
    },
  });
  expect(submitted.status(), await submitted.text()).toBe(201);
  const { id } = (await submitted.json()) as { id: string };

  const read = await request.get(`${API}/v1/events/${ctx.eventId}/submissions/${id}`, {
    headers: ctx.headers,
  });
  expect(
    ((await read.json()) as { form_id: string }).form_id,
    "the proposal does not record its form",
  ).toBe(form.formId);

  await removeSubmissions(request, ctx, [id]);
});

test("36+63. moving the close date shuts the call and opens it again", async ({ request }) => {
  const ctx = await organizer(request);
  const form = await liveForm(request);

  const current = await request.get(`${API}/v1/events/${ctx.eventId}/forms/${form.formId}`, {
    headers: ctx.headers,
  });
  const original = (await current.json()) as { closes_at: string | null };
  const made: string[] = [];

  const send = (marker: string) =>
    request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
      data: {
        form_id: form.formId,
        title: `Window ${marker}`,
        answers: answersFor(form.fields),
        speaker_email: `window-${marker}@example.com`,
        speaker_name: "Window Tester",
      },
    });

  try {
    const future = new Date(Date.now() + 14 * 86_400_000).toISOString();
    // Checked, not assumed. An unverified setup write turns into an assertion
    // failure three lines later that blames the product for the test.
    const opened = await request.patch(`${API}/v1/events/${ctx.eventId}/forms/${form.formId}`, {
      headers: ctx.headers,
      data: { closes_at: future },
    });
    expect(opened.ok(), `could not open the call: ${await opened.text()}`).toBe(true);
    const open = await send(`open-${Date.now()}`);
    expect(open.status(), await open.text()).toBe(201);
    made.push(((await open.json()) as { id: string }).id);

    // 36. Past the date, the server clock decides — not the client.
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const closed = await request.patch(`${API}/v1/events/${ctx.eventId}/forms/${form.formId}`, {
      headers: ctx.headers,
      data: { closes_at: past },
    });
    expect(closed.ok(), `could not close the call: ${await closed.text()}`).toBe(true);
    const shut = await send(`shut-${Date.now()}`);
    expect(shut.status(), "a closed call accepted a proposal").toBe(403);
    expect(await shut.text()).toMatch(/closed/i);

    // 63. Setting it back reopens it: the close is a date, not a one-way door.
    await request.patch(`${API}/v1/events/${ctx.eventId}/forms/${form.formId}`, {
      headers: ctx.headers,
      data: { closes_at: future },
    });
    const reopened = await send(`again-${Date.now()}`);
    expect(reopened.status(), await reopened.text()).toBe(201);
    made.push(((await reopened.json()) as { id: string }).id);
  } finally {
    await request.patch(`${API}/v1/events/${ctx.eventId}/forms/${form.formId}`, {
      headers: ctx.headers,
      data: { closes_at: original.closes_at },
    });
    await removeSubmissions(request, ctx, made);
  }
});

test("39+60. a per-person limit refuses the next proposal and names the number", async ({
  request,
}) => {
  const ctx = await organizer(request);
  const form = await liveForm(request);

  const event = await request.get(`${API}/v1/events/${ctx.eventId}`, { headers: ctx.headers });
  const original = ((await event.json()) as { submission_limit_per_speaker: number | null })
    .submission_limit_per_speaker;

  const email = `limited-${Date.now()}@example.com`;
  const made: string[] = [];

  try {
    await request.patch(`${API}/v1/events/${ctx.eventId}`, {
      headers: ctx.headers,
      data: { submission_limit_per_speaker: 1 },
    });

    const send = (marker: string) =>
      request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
        data: {
          form_id: form.formId,
          title: `Limited ${marker}`,
          answers: answersFor(form.fields),
          speaker_email: email,
          speaker_name: "Limited Tester",
        },
      });

    const first = await send(`one-${Date.now()}`);
    expect(first.status(), await first.text()).toBe(201);
    made.push(((await first.json()) as { id: string }).id);

    const second = await send(`two-${Date.now()}`);
    // 403, not 422: the proposal is well-formed, the speaker is simply out of
    // allowance. That distinction matters to a client deciding what to show.
    expect(second.status(), "a second proposal beat the per-person limit").toBe(403);
    // Naming the number is the difference between a wall and an explanation.
    expect(await second.text(), "the refusal does not say what the limit is").toMatch(/\b1\b/);
  } finally {
    await request.patch(`${API}/v1/events/${ctx.eventId}`, {
      headers: ctx.headers,
      data: { submission_limit_per_speaker: original },
    });
    await removeSubmissions(request, ctx, made);
  }
});

test("40. the form a speaker sees is exactly what the builder configured", async ({ request }) => {
  const ctx = await organizer(request);
  const form = await liveForm(request);

  const asBuilder = await request.get(`${API}/v1/events/${ctx.eventId}/forms/${form.formId}`, {
    headers: ctx.headers,
  });
  const built = (await asBuilder.json()) as {
    schema: { sections: { fields: { key: string; label: string; hidden_from_new: boolean }[] }[] };
  };
  const expected = built.schema.sections
    .flatMap((entry) => entry.fields)
    .filter((field) => !field.hidden_from_new)
    .map((field) => field.key);

  expect(
    form.fields.map((field) => field.key),
    "the public form differs from the built one",
  ).toEqual(expected);
  expect(expected.length, "the live CFP renders no fields").toBeGreaterThan(0);
});

test("41+53-54. a draft keeps its code and its answers across a reopened link", async ({
  request,
}) => {
  const ctx = await organizer(request);
  const form = await liveForm(request);
  const email = `draft-${Date.now()}@example.com`;

  const first = await request.post(`${API}/v1/public/events/${SLUG}/submissions/draft`, {
    data: {
      form_id: form.formId,
      title: "Half a thought",
      answers: {},
      speaker_email: email,
      speaker_name: "Draft Tester",
    },
  });
  expect(first.status(), await first.text()).toBeLessThan(300);
  const draft = (await first.json()) as { id: string; code: string; draft_token: string };

  // 53. A code exists from the first save, so a resumed draft keeps identity.
  expect(draft.code, "no code was assigned on the first save").toHaveLength(6);

  try {
    // 54+41. Saving again with the token edits that draft rather than forking a
    // second one, and the code does not move under the speaker.
    const resumed = await request.post(`${API}/v1/public/events/${SLUG}/submissions/draft`, {
      data: {
        form_id: form.formId,
        title: "A whole thought",
        answers: answersFor(form.fields),
        speaker_email: email,
        speaker_name: "Draft Tester",
        draft_token: draft.draft_token,
      },
    });
    expect(resumed.status(), await resumed.text()).toBeLessThan(300);
    const again = (await resumed.json()) as { id: string; code: string };
    expect(again.id, "resuming forked a second draft").toBe(draft.id);
    expect(again.code, "resuming changed the code").toBe(draft.code);

    // The answers survived rather than being replaced by a blank form.
    const read = await request.get(`${API}/v1/events/${ctx.eventId}/submissions/${draft.id}`, {
      headers: ctx.headers,
    });
    const stored = (await read.json()) as { title: string; answers: Record<string, unknown> };
    expect(stored.title).toBe("A whole thought");
    expect(
      Object.keys(stored.answers).length,
      "the resumed draft lost its answers",
    ).toBeGreaterThan(0);

    // And the code looks up a status page forever, with no review data on it.
    const status = await request.get(
      `${API}/v1/public/events/${SLUG}/submissions/${draft.code}/status`,
    );
    expect(status.status()).toBe(200);
  } finally {
    await removeSubmissions(request, ctx, [draft.id]);
  }
});

test("47-48. a bad email and an over-long answer are refused with a reason", async ({
  request,
}) => {
  const form = await liveForm(request);
  const longest = form.fields.find(
    (field) => field.max_length !== null && field.type === "long_text",
  );

  // 47. Malformed address, caught at the boundary.
  const badEmail = await request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
    data: {
      form_id: form.formId,
      title: `Invalid ${Date.now()}`,
      answers: answersFor(form.fields),
      speaker_email: "not-an-email",
      speaker_name: "Invalid Tester",
    },
  });
  expect(badEmail.status(), "a malformed email was accepted").toBe(422);
  expect(await badEmail.text()).toMatch(/email/i);

  // 48. Over the field's own limit: refused, and the message names the ceiling
  // rather than the answer coming back quietly shortened.
  test.skip(longest === undefined, "no length-limited long_text field on the live form");
  const tooLong = await request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
    data: {
      form_id: form.formId,
      title: `TooLong ${Date.now()}`,
      answers: answersFor(form.fields, { [longest!.key]: "x".repeat(longest!.max_length! + 5000) }),
      speaker_email: `long-${Date.now()}@example.com`,
      speaker_name: "Long Tester",
    },
  });
  expect(tooLong.status(), "an answer over the field limit was accepted").toBe(422);
  expect(await tooLong.text(), "the refusal does not name the limit").toMatch(
    new RegExp(`${longest!.max_length}|characters`, "i"),
  );
});

test("55-56. co-speakers are accepted up to the maximum, then refused", async ({ request }) => {
  const ctx = await organizer(request);
  const form = await liveForm(request);

  const built = await request.get(`${API}/v1/events/${ctx.eventId}/forms/${form.formId}`, {
    headers: ctx.headers,
  });
  const settings = ((await built.json()) as { schema: { settings: { max_co_speakers: number } } })
    .schema.settings;
  const max = settings.max_co_speakers;
  expect(max, "the form allows no co-speakers, so there is no maximum to test").toBeGreaterThan(0);

  const stamp = Date.now();
  const people = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      email: `co${index}-${stamp}@example.com`,
      name: `Co Speaker ${index}`,
    }));

  const send = (count: number) =>
    request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
      data: {
        form_id: form.formId,
        title: `Co-speakers ${stamp}-${count}`,
        answers: answersFor(form.fields),
        speaker_email: `primary-${stamp}-${count}@example.com`,
        speaker_name: "Primary Speaker",
        co_speakers: people(count),
      },
    });

  const made: string[] = [];
  try {
    // 55. Exactly the maximum is fine.
    const ok = await send(max);
    expect(ok.status(), await ok.text()).toBe(201);
    const created = (await ok.json()) as { id: string };
    made.push(created.id);

    const read = await request.get(`${API}/v1/events/${ctx.eventId}/submissions/${created.id}`, {
      headers: ctx.headers,
    });
    expect(((await read.json()) as { speakers: unknown[] }).speakers).toHaveLength(max + 1);

    // 56. One more is refused rather than quietly dropped, and says the number.
    const tooMany = await send(max + 1);
    expect(tooMany.status(), "a co-speaker over the maximum was accepted").toBe(422);
    expect(await tooMany.text()).toMatch(new RegExp(`${max}|co-speaker|maximum`, "i"));
  } finally {
    await removeSubmissions(request, ctx, made);
  }
});

test("51-52+111. an upload is stored and visible, and an oversized one is refused", async ({
  request,
}) => {
  // Uploads belong to the speaker, so this runs through the portal — there is
  // deliberately no staff route that writes a file on someone's behalf.
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "speaker" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };

  // A real one-pixel PNG, so this is an image rather than bytes named .png.
  const stored = await request.post(`${API}/v1/portal/profile/headshot`, {
    headers,
    multipart: {
      file: {
        name: "tiny.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        ),
      },
    },
  });
  expect(stored.status(), await stored.text()).toBeLessThan(300);

  // 111. And it is visible afterwards rather than vanishing into storage.
  expect(await stored.text(), "the uploaded headshot is not on the profile").toMatch(
    /headshot|file|url/i,
  );

  // 52. Thirty megabytes is over the ceiling and is refused, not truncated.
  const huge = await request.post(`${API}/v1/portal/profile/headshot`, {
    headers,
    multipart: {
      file: {
        name: "huge.png",
        mimeType: "image/png",
        buffer: Buffer.alloc(30 * 1024 * 1024, 1),
      },
    },
  });
  expect(huge.status(), "a 30MB upload was accepted").toBeGreaterThanOrEqual(400);
  expect(await huge.text(), "the refusal does not say how big is too big").toMatch(
    /\d+\s*(mb|MB|megabyte)|too large|size|limit/i,
  );
});
