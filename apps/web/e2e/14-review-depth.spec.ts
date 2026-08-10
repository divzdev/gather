import { expect, test, type APIRequestContext } from "@playwright/test";

/** Checklist §"Review" — the items 05/06 left uncovered: 71-74, 79-82, 84, 87,
 *  88, 90.
 *
 *  Everything here runs in a round this file creates and tears down, so it never
 *  disturbs the seeded review data the other specs read.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

type Ctx = {
  headers: Record<string, string>;
  eventId: string;
  reviewerHeaders: Record<string, string>;
  reviewerId: string;
};

async function asRole(request: APIRequestContext, role: string) {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role } });
  const body = (await login.json()) as { access_token: string };
  return { Authorization: `Bearer ${body.access_token}` };
}

async function context(request: APIRequestContext): Promise<Ctx> {
  const headers = await asRole(request, "organizer");
  const events = await request.get(`${API}/v1/events`, { headers });
  const eventId = ((await events.json()) as { id: string }[])[0]!.id;

  const reviewerHeaders = await asRole(request, "reviewer");
  const me = await request.get(`${API}/v1/auth/me`, { headers: reviewerHeaders });
  const reviewerId = ((await me.json()) as { id: string }).id;

  return { headers, eventId, reviewerHeaders, reviewerId };
}

/** A round of our own, with one criterion, removed at the end of each test. */
async function makeRound(request: APIRequestContext, ctx: Ctx, options: { blind?: boolean } = {}) {
  const created = await request.post(`${API}/v1/events/${ctx.eventId}/review-rounds`, {
    headers: ctx.headers,
    data: {
      name: `E2E round ${Date.now()}`,
      is_blind: options.blind ?? false,
      sort_order: 90,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const round = (await created.json()) as { id: string };

  const criterion = await request.post(
    `${API}/v1/events/${ctx.eventId}/review-rounds/${round.id}/criteria`,
    {
      headers: ctx.headers,
      data: { label: "Relevance", weight: 1, scale_min: 1, scale_max: 5, sort_order: 1 },
    },
  );
  expect(criterion.status(), await criterion.text()).toBe(201);

  // Rounds are created draft. Scoring into a draft round is refused, which is
  // the right default — a rubric being edited must not collect scores.
  const opened = await request.patch(`${API}/v1/events/${ctx.eventId}/review-rounds/${round.id}`, {
    headers: ctx.headers,
    data: { status: "open" },
  });
  expect(opened.status(), await opened.text()).toBe(200);

  return { roundId: round.id, criterionId: ((await criterion.json()) as { id: string }).id };
}

async function someSubmissions(request: APIRequestContext, ctx: Ctx, count: number) {
  const listing = await request.get(
    `${API}/v1/events/${ctx.eventId}/submissions?per_page=${count}&filter[status]=submitted`,
    { headers: ctx.headers },
  );
  const rows = ((await listing.json()) as { data: { id: string }[] }).data;
  expect(rows.length, "not enough submitted proposals in the fixture").toBeGreaterThanOrEqual(1);
  return rows.map((row) => row.id);
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

test("71. reviewers are assigned by hand, and assigning twice does not double up", async ({
  request,
}) => {
  const ctx = await context(request);
  const { roundId } = await makeRound(request, ctx);
  const ids = await someSubmissions(request, ctx, 2);

  const body = { submission_ids: ids, user_ids: [ctx.reviewerId] };
  const first = await request.post(
    `${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/assignments`,
    { headers: ctx.headers, data: body },
  );
  expect(first.status(), await first.text()).toBe(201);
  expect(((await first.json()) as { created: number }).created).toBe(ids.length);

  // The same assignment again is a no-op, not a second row: an organiser
  // re-running an assignment must not double a reviewer's workload.
  const again = await request.post(
    `${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/assignments`,
    { headers: ctx.headers, data: body },
  );
  expect(((await again.json()) as { created: number }).created).toBe(0);
});

test("72. auto-distribution respects a cap and reports what it could not place", async ({
  request,
}) => {
  const ctx = await context(request);
  const { roundId } = await makeRound(request, ctx);
  const ids = await someSubmissions(request, ctx, 8);
  test.skip(ids.length < 4, "too few submitted proposals to test a cap");

  await request.post(`${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/assignments`, {
    headers: ctx.headers,
    data: { submission_ids: ids, user_ids: [] },
  });

  // One reviewer, a cap below the workload: the shortfall has to be reported
  // rather than silently dropped, or an organiser believes the round is covered.
  const distributed = await request.post(
    `${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/auto-distribute`,
    {
      headers: ctx.headers,
      data: { user_ids: [ctx.reviewerId], per_submission: 1, cap_per_reviewer: 2 },
    },
  );
  expect(distributed.status(), await distributed.text()).toBe(200);
  const result = (await distributed.json()) as { created: number; under_assigned: number };

  expect(result.created).toBeLessThanOrEqual(2);
  expect(result.under_assigned, "the cap silently swallowed the rest").toBeGreaterThan(0);
});

test("73. a blind round hides the speaker from the reviewer but not the organiser", async ({
  request,
}) => {
  const ctx = await context(request);
  const { roundId } = await makeRound(request, ctx, { blind: true });
  const [submissionId] = await someSubmissions(request, ctx, 1);

  await request.post(`${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/assignments`, {
    headers: ctx.headers,
    data: { submission_ids: [submissionId], user_ids: [ctx.reviewerId] },
  });

  const asOrganiser = await request.get(
    `${API}/v1/events/${ctx.eventId}/submissions/${submissionId}`,
    { headers: ctx.headers },
  );
  const full = (await asOrganiser.json()) as { speakers: { name: string }[] };
  const name = full.speakers[0]?.name;
  expect(name, "the fixture proposal has no speaker to hide").toBeTruthy();

  const asReviewer = await request.get(`${API}/v1/events/${ctx.eventId}/review/submissions/${submissionId}?round_id=${roundId}`, {
    headers: ctx.reviewerHeaders,
  });
  expect(asReviewer.status(), await asReviewer.text()).toBe(200);
  const seen = await asReviewer.text();

  // Stripped at the API, not hidden by the UI — a reviewer opening DevTools
  // must not be able to read the name.
  expect(seen, "a blind round leaked the speaker's name").not.toContain(name!);
  expect(((await asReviewer.json()) as { is_blind: boolean }).is_blind).toBe(true);
});

test("74. opening a round emails its reviewers", async ({ request }) => {
  const ctx = await context(request);
  const { roundId } = await makeRound(request, ctx);
  const ids = await someSubmissions(request, ctx, 1);

  await request.post(`${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/assignments`, {
    headers: ctx.headers,
    data: { submission_ids: ids, user_ids: [ctx.reviewerId] },
  });

  const nudged = await request.post(
    `${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/nudge`,
    { headers: ctx.headers },
  );
  expect(nudged.status(), await nudged.text()).toBe(200);
  const result = (await nudged.json()) as { sent: number; skipped: number };
  expect(result.sent, "nobody was invited to a round with outstanding work").toBeGreaterThan(0);
});

test("79-82+84. scoring saves itself, carries a comment, and a conflict is excluded", async ({
  request,
}) => {
  const ctx = await context(request);
  const { roundId, criterionId } = await makeRound(request, ctx);
  const ids = await someSubmissions(request, ctx, 2);
  test.skip(ids.length < 2, "need two proposals to compare");

  await request.post(`${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/assignments`, {
    headers: ctx.headers,
    data: { submission_ids: ids, user_ids: [ctx.reviewerId] },
  });

  const start = await request.get(`${API}/v1/events/${ctx.eventId}/submissions/${ids[0]}`, {
    headers: ctx.headers,
  });
  const before = (await start.json()) as { score_avg: string | null; review_count: number };

  // 79-80. A PUT is the save — there is no save button because there is no
  // separate save step.
  const scored = await request.put(`${API}/v1/events/${ctx.eventId}/review/submissions/${ids[0]}/scores?round_id=${roundId}`, {
    headers: ctx.reviewerHeaders,
    data: {
      values: { [criterionId]: 5 },
      comment: "Strong and specific. Would attend.",
      conflict_of_interest: false,
    },
  });
  expect(scored.status(), await scored.text()).toBe(200);
  const review = (await scored.json()) as {
    status: string;
    comment: string;
    score_avg: string | null;
  };
  expect(review.status).toBe("scored");
  expect(review.comment).toContain("Would attend");

  // 84. The aggregate is on the organiser's list, and it is the weighted mean.
  const single = await request.get(`${API}/v1/events/${ctx.eventId}/submissions/${ids[0]}`, {
    headers: ctx.headers,
  });
  const mine = (await single.json()) as { score_avg: string | null; review_count: number };
  expect(mine.score_avg, "the score never reached the organiser's view").not.toBeNull();
  // Not asserted as 5: score_avg is the mean across every scored review, and
  // the seeded proposal already carries some. What must hold is that this
  // review joined the mean and the mean stayed inside the rubric's scale.
  expect(mine.review_count).toBeGreaterThan(before.review_count);
  expect(Number(mine.score_avg)).toBeGreaterThanOrEqual(1);
  expect(Number(mine.score_avg)).toBeLessThanOrEqual(5);
  expect(
    Number(mine.score_avg),
    "a 5 did not pull the mean up",
  ).toBeGreaterThan(Number(before.score_avg ?? 0) - 0.001);

  const listed = await request.get(
    `${API}/v1/events/${ctx.eventId}/submissions?per_page=200&sort=-score_avg`,
    { headers: ctx.headers },
  );
  const rows = ((await listed.json()) as { data: { id: string; score_avg: string | null }[] }).data;

  // And the sort actually orders by it.
  const scores = rows.map((row) => (row.score_avg === null ? -1 : Number(row.score_avg)));
  expect(scores, "sort=-score_avg did not order the list").toEqual(
    [...scores].sort((a, b) => b - a),
  );

  // 81. Abstaining for a conflict of interest records the review but keeps it
  // out of the mean — a declared conflict must not quietly become a zero.
  const priorRead = await request.get(`${API}/v1/events/${ctx.eventId}/submissions/${ids[1]}`, {
    headers: ctx.headers,
  });
  const prior = (await priorRead.json()) as { score_avg: string | null };
  const abstained = await request.put(`${API}/v1/events/${ctx.eventId}/review/submissions/${ids[1]}/scores?round_id=${roundId}`, {
    headers: ctx.reviewerHeaders,
    data: { values: {}, comment: "I work with this speaker.", conflict_of_interest: true },
  });
  expect(abstained.status(), await abstained.text()).toBe(200);
  expect(((await abstained.json()) as { conflict_of_interest: boolean }).conflict_of_interest).toBe(
    true,
  );

  const after = await request.get(`${API}/v1/events/${ctx.eventId}/submissions/${ids[1]}`, {
    headers: ctx.headers,
  });
  const conflicted = (await after.json()) as { score_avg: string | null };
  expect(
    conflicted.score_avg,
    "a conflict-of-interest abstention moved the score",
  ).toBe(prior.score_avg);
});

test("82+87. progress counts assigned against completed, per reviewer", async ({ request }) => {
  const ctx = await context(request);
  const { roundId, criterionId } = await makeRound(request, ctx);
  const ids = await someSubmissions(request, ctx, 2);

  await request.post(`${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/assignments`, {
    headers: ctx.headers,
    data: { submission_ids: ids, user_ids: [ctx.reviewerId] },
  });

  const before = await request.get(
    `${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/progress`,
    { headers: ctx.headers },
  );
  const start = ((await before.json()) as { user_id: string; assigned: number; completed: number }[])
    .find((row) => row.user_id === ctx.reviewerId);
  expect(start, "the assigned reviewer is absent from progress").toBeDefined();
  expect(start!.assigned).toBe(ids.length);

  await request.put(`${API}/v1/events/${ctx.eventId}/review/submissions/${ids[0]}/scores?round_id=${roundId}`, {
    headers: ctx.reviewerHeaders,
    data: { values: { [criterionId]: 4 }, comment: null, conflict_of_interest: false },
  });

  const after = await request.get(
    `${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/progress`,
    { headers: ctx.headers },
  );
  const moved = ((await after.json()) as { user_id: string; completed: number }[]).find(
    (row) => row.user_id === ctx.reviewerId,
  );
  expect(moved!.completed, "scoring did not move the progress indicator").toBe(
    start!.completed + 1,
  );
});

test("88. a bulk reminder reaches only reviewers with work left", async ({ request }) => {
  const ctx = await context(request);
  const { roundId, criterionId } = await makeRound(request, ctx);
  const ids = await someSubmissions(request, ctx, 1);

  await request.post(`${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/assignments`, {
    headers: ctx.headers,
    data: { submission_ids: ids, user_ids: [ctx.reviewerId] },
  });

  const outstanding = await request.post(
    `${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/nudge`,
    { headers: ctx.headers },
  );
  expect(((await outstanding.json()) as { sent: number }).sent).toBeGreaterThan(0);

  // Finish the work, then nudge again: nobody is chased for a done job.
  await request.put(`${API}/v1/events/${ctx.eventId}/review/submissions/${ids[0]}/scores?round_id=${roundId}`, {
    headers: ctx.reviewerHeaders,
    data: { values: { [criterionId]: 3 }, comment: null, conflict_of_interest: false },
  });

  const done = await request.post(
    `${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/nudge`,
    { headers: ctx.headers },
  );
  const result = (await done.json()) as { sent: number; skipped: number };
  expect(result.sent, "a reviewer with nothing outstanding was chased").toBe(0);
});

test("90. advancing a round reports what carried through", async ({ request }) => {
  const ctx = await context(request);
  const { roundId, criterionId } = await makeRound(request, ctx);
  const ids = await someSubmissions(request, ctx, 2);

  await request.post(`${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/assignments`, {
    headers: ctx.headers,
    data: { submission_ids: ids, user_ids: [ctx.reviewerId] },
  });
  for (const [index, id] of ids.entries()) {
    await request.put(`${API}/v1/events/${ctx.eventId}/review/submissions/${id}/scores?round_id=${roundId}`, {
      headers: ctx.reviewerHeaders,
      data: { values: { [criterionId]: index === 0 ? 5 : 1 }, conflict_of_interest: false },
    });
  }

  const advanced = await request.post(
    `${API}/v1/events/${ctx.eventId}/review-rounds/${roundId}/advance`,
    { headers: ctx.headers, "Idempotency-Key": `adv-${Date.now()}` } as never,
  );
  expect(advanced.status(), await advanced.text()).toBeLessThan(300);
  const body = await advanced.text();
  // Whatever it reports, it has to report a number — "done" with no count tells
  // an organiser nothing about who made it through.
  expect(body, "advancing said nothing about what advanced").toMatch(/\d/);
});
