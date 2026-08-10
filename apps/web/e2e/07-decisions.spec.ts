import { expect, test, type APIRequestContext } from "@playwright/test";

import { clearRateLimits } from "./support/rate-limits";

/** Checklist §"Decide and notify" — items 91-98.
 *
 *  This is the product's most important rule: deciding is not sending. These
 *  tests create their own submissions rather than deciding on seeded ones, so a
 *  run never leaves someone else's proposal marked rejected.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
const SLUG = "devflow-conf-2027";

async function organizer(request: APIRequestContext) {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const [event] = (await events.json()) as { id: string }[];
  return { headers, eventId: event!.id };
}

/** Fresh proposals submitted through the public form, so they are ours to decide. */
async function submitProposals(request: APIRequestContext, count: number): Promise<string[]> {
  const payload = await request.get(`${API}/v1/public/events/${SLUG}/cfp-form`);
  const form = (await payload.json()) as {
    form_id: string;
    schema: {
      sections: {
        fields: { key: string; type: string; required: boolean; choices: { value: string }[] }[];
      }[];
    };
  };
  const answers: Record<string, unknown> = {};
  for (const field of form.schema.sections
    .flatMap((section) => section.fields)
    .filter((entry) => entry.required)) {
    answers[field.key] =
      field.choices.length > 0
        ? field.choices[0]!.value
        : field.type === "number"
          ? 1
          : field.type === "checkbox"
            ? true
            : "A sufficiently long answer.";
  }

  const ids: string[] = [];
  const stamp = Date.now();
  for (let index = 0; index < count; index += 1) {
    // Four at a time, then reset: the public form allows five an hour per IP.
    if (index % 4 === 0) await clearRateLimits();
    const response = await request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
      data: {
        form_id: form.form_id,
        title: `Decision fixture ${stamp}-${index}`,
        answers,
        speaker_email: `decide-${stamp}-${index}@example.com`,
        speaker_name: `Decision Tester ${index}`,
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    ids.push(((await response.json()) as { id: string }).id);
  }
  return ids;
}

async function outboxSize(request: APIRequestContext, ctx: { headers: Record<string, string>; eventId: string }) {
  const outbox = await request.get(`${API}/v1/events/${ctx.eventId}/messages/outbox`, {
    headers: ctx.headers,
  });
  const body = (await outbox.json()) as { data?: unknown[] } | unknown[];
  return Array.isArray(body) ? body.length : (body.data?.length ?? 0);
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

// Each test submits several proposals, and the public form allows five an hour
// per IP — the right budget for a call for papers, exhausted by one fixture.
test.beforeEach(async () => {
  await clearRateLimits();
});

test("91-92. deciding in bulk sends absolutely nothing", async ({ request }) => {
  const ctx = await organizer(request);
  const ids = await submitProposals(request, 6);
  const before = await outboxSize(request, ctx);

  const accepted = await request.post(`${API}/v1/events/${ctx.eventId}/submissions/bulk-decision`, {
    headers: { ...ctx.headers, "Idempotency-Key": `accept-${Date.now()}` },
    data: { submission_ids: ids.slice(0, 3), outcome: "accepted" },
  });
  const rejected = await request.post(`${API}/v1/events/${ctx.eventId}/submissions/bulk-decision`, {
    headers: { ...ctx.headers, "Idempotency-Key": `reject-${Date.now()}` },
    data: { submission_ids: ids.slice(3), outcome: "rejected" },
  });

  expect(accepted.status(), await accepted.text()).toBeLessThan(300);
  expect(rejected.status(), await rejected.text()).toBeLessThan(300);

  // 92. The single most important assertion in the suite.
  expect(await outboxSize(request, ctx), "deciding sent email").toBe(before);

  // And every one of them is queued, not sent.
  const listing = await request.get(
    `${API}/v1/events/${ctx.eventId}/submissions?per_page=200&sort=-created_at`,
    { headers: ctx.headers },
  );
  const rows = ((await listing.json()) as {
    data: { id: string; status: string; decision_status: string }[];
  }).data;
  for (const id of ids) {
    const row = rows.find((entry) => entry.id === id);
    expect(row, "a decided submission vanished from the list").toBeDefined();
    expect(row!.decision_status).toBe("pending_send");
    expect(["accepted", "rejected"]).toContain(row!.status);
  }
});

test("93-95. sending needs the count, and a stale count is refused", async ({ request }) => {
  const ctx = await organizer(request);
  await submitProposals(request, 2).then((ids) =>
    request.post(`${API}/v1/events/${ctx.eventId}/submissions/bulk-decision`, {
      headers: { ...ctx.headers, "Idempotency-Key": `stale-${Date.now()}` },
      data: { submission_ids: ids, outcome: "rejected" },
    }),
  );

  const pending = await request.get(`${API}/v1/events/${ctx.eventId}/messages/decision-recipients`, {
    headers: ctx.headers,
  });
  expect(pending.status(), await pending.text()).toBe(200);
  const recipients = (await pending.json()) as {
    total: number;
    by_outcome: Record<string, number>;
  };
  // The send is filtered to one outcome, so the count it confirms is that
  // outcome's own, not the total across all of them.
  const total = recipients.by_outcome.rejected ?? 0;
  expect(total, "nothing rejected is pending to send").toBeGreaterThan(0);

  // 95. The stale-tab case: a count the server no longer agrees with is refused,
  // and the message says the list moved rather than silently sending anyway.
  const stale = await request.post(`${API}/v1/events/${ctx.eventId}/messages/send-decisions`, {
    headers: { ...ctx.headers, "Idempotency-Key": `send-stale-${Date.now()}` },
    data: { outcomes: ["rejected"], confirm_recipient_count: total + 7 },
  });

  expect(stale.status()).toBe(409);
  const error = (await stale.json()) as { error: { code: string; message: string } };
  expect(error.error.code).toBe("RECIPIENT_COUNT_MISMATCH");
  expect(error.error.message).toMatch(/reload|check|pending/i);
});

test("93-96. an honest count sends, one row per recipient", async ({ request }) => {
  const ctx = await organizer(request);
  const ids = await submitProposals(request, 3);
  await request.post(`${API}/v1/events/${ctx.eventId}/submissions/bulk-decision`, {
    headers: { ...ctx.headers, "Idempotency-Key": `waitlist-${Date.now()}` },
    data: { submission_ids: ids, outcome: "waitlisted" },
  });

  const pending = await request.get(`${API}/v1/events/${ctx.eventId}/messages/decision-recipients`, {
    headers: ctx.headers,
  });
  const body = (await pending.json()) as { total: number; by_outcome: Record<string, number> };
  const total = body.by_outcome.waitlisted ?? 0;
  expect(total).toBeGreaterThanOrEqual(3);

  const before = await outboxSize(request, ctx);
  const sent = await request.post(`${API}/v1/events/${ctx.eventId}/messages/send-decisions`, {
    headers: { ...ctx.headers, "Idempotency-Key": `send-good-${Date.now()}` },
    data: { outcomes: ["waitlisted"], confirm_recipient_count: total },
  });

  expect(sent.status(), await sent.text()).toBeLessThan(300);
  const result = (await sent.json()) as { sent?: number; queued?: number };
  const count = result.sent ?? result.queued ?? 0;
  expect(count, "the send reported nothing").toBeGreaterThan(0);

  // 96. One outbox row per recipient, not one per batch.
  expect(await outboxSize(request, ctx)).toBe(before + count);
});
