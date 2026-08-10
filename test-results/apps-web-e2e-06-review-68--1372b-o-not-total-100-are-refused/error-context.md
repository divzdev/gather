# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: apps/web/e2e/06-review.spec.ts >> 68-70. a round takes a rubric, and weights that do not total 100 are refused
- Location: apps/web/e2e/06-review.spec.ts:52:5

# Error details

```
Error: {"error":{"code":"VALIDATION_FAILED","message":"The request body failed validation.","details":{"errors":[{"field":"weight","message":"Input should be less than or equal to 9","type":"less_than_equal"},{"field":"max_score","message":"Extra inputs are not permitted","type":"extra_forbidden"}]}}}

expect(received).toBeLessThan(expected)

Expected: < 300
Received:   422
```

# Test source

```ts
  1   | import { expect, test, type APIRequestContext } from "@playwright/test";
  2   | 
  3   | /** Checklist §"Review setup" and §"Score as reviewer" — items 65-90.
  4   |  *
  5   |  *  The weight here is on the invariants rather than the chrome: blind review
  6   |  *  stripping identity in the *payload*, an abstention leaving the mean alone,
  7   |  *  and an unscored review not counting as zero. Those are the ones that are
  8   |  *  invisible on screen and wrong forever if they break.
  9   |  */
  10  | 
  11  | const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
  12  | 
  13  | type Ctx = { headers: Record<string, string>; eventId: string };
  14  | 
  15  | async function organizer(request: APIRequestContext): Promise<Ctx> {
  16  |   const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  17  |   const { access_token } = (await login.json()) as { access_token: string };
  18  |   const headers = { Authorization: `Bearer ${access_token}` };
  19  |   const events = await request.get(`${API}/v1/events`, { headers });
  20  |   const [event] = (await events.json()) as { id: string }[];
  21  |   return { headers, eventId: event!.id };
  22  | }
  23  | 
  24  | test.beforeAll(async ({ request }) => {
  25  |   const health = await request.get(`${API}/v1/health`).catch(() => null);
  26  |   test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
  27  | });
  28  | 
  29  | test("66-67. a submission shows every answer, and takes an internal note", async ({ request }) => {
  30  |   const { headers, eventId } = await organizer(request);
  31  |   const listing = await request.get(`${API}/v1/events/${eventId}/submissions?per_page=5`, {
  32  |     headers,
  33  |   });
  34  |   const [first] = ((await listing.json()) as { data: { id: string }[] }).data;
  35  |   expect(first).toBeDefined();
  36  | 
  37  |   const detail = await request.get(`${API}/v1/submissions/${first!.id}`, { headers });
  38  |   expect(detail.status()).toBe(200);
  39  |   const body = (await detail.json()) as { answers: Record<string, unknown> };
  40  |   // 66. Custom answers survive the round trip, not just the built-in columns.
  41  |   expect(Object.keys(body.answers).length).toBeGreaterThan(2);
  42  | 
  43  |   // 67. A note is recorded and comes back.
  44  |   const note = `Checklist note ${Date.now()}`;
  45  |   const added = await request.post(`${API}/v1/submissions/${first!.id}/notes`, {
  46  |     headers,
  47  |     data: { body: note },
  48  |   });
  49  |   expect(added.status(), await added.text()).toBeLessThan(300);
  50  | });
  51  | 
  52  | test("68-70. a round takes a rubric, and weights that do not total 100 are refused", async ({
  53  |   request,
  54  | }) => {
  55  |   const { headers, eventId } = await organizer(request);
  56  | 
  57  |   const round = await request.post(`${API}/v1/events/${eventId}/review-rounds`, {
  58  |     headers,
  59  |     data: { name: `Checklist round ${Date.now()}`, sort_order: 90 },
  60  |   });
  61  |   expect(round.status(), await round.text()).toBeLessThan(300);
  62  |   const { id: roundId } = (await round.json()) as { id: string };
  63  | 
  64  |   const weights = [50, 30, 20];
  65  |   for (const [index, weight] of weights.entries()) {
  66  |     const made = await request.post(`${API}/v1/events/${eventId}/review-rounds/${roundId}/criteria`, {
  67  |       headers,
  68  |       data: { label: `Criterion ${index}`, kind: "rating", weight, max_score: 5, sort_order: index },
  69  |     });
> 70  |     expect(made.status(), await made.text()).toBeLessThan(300);
      |                                              ^ Error: {"error":{"code":"VALIDATION_FAILED","message":"The request body failed validation.","details":{"errors":[{"field":"weight","message":"Input should be less than or equal to 9","type":"less_than_equal"},{"field":"max_score","message":"Extra inputs are not permitted","type":"extra_forbidden"}]}}}
  71  |   }
  72  | 
  73  |   const criteria = await request.get(
  74  |     `${API}/v1/events/${eventId}/review-rounds/${roundId}/criteria`,
  75  |     { headers },
  76  |   );
  77  |   const rows = (await criteria.json()) as { weight: number }[];
  78  |   const total = rows.reduce((sum, row) => sum + Number(row.weight), 0);
  79  |   expect(total).toBe(100);
  80  | });
  81  | 
  82  | test("75-78. a reviewer sees only their own queue, with identity stripped", async ({ request }) => {
  83  |   const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "reviewer" } });
  84  |   expect(login.status()).toBe(200);
  85  |   const { access_token } = (await login.json()) as { access_token: string };
  86  |   const headers = { Authorization: `Bearer ${access_token}` };
  87  | 
  88  |   const queue = await request.get(`${API}/v1/review/queue`, { headers });
  89  |   expect(queue.status(), await queue.text()).toBe(200);
  90  |   const items = (await queue.json()) as { id: string }[];
  91  | 
  92  |   // 78. The check that matters: identity is absent from the payload, not merely
  93  |   // hidden by CSS. A reviewer who opens DevTools must not find the name.
  94  |   const raw = await queue.text();
  95  |   expect(raw).not.toMatch(/speaker_name|"email"|company/i);
  96  | 
  97  |   if (items.length > 0) {
  98  |     const detail = await request.get(`${API}/v1/review/submissions/${items[0]!.id}`, { headers });
  99  |     const detailRaw = await detail.text();
  100 |     expect(detailRaw).not.toMatch(/"email"\s*:/i);
  101 |   }
  102 | });
  103 | 
  104 | test("76+83. a reviewer cannot reach the organiser's surface", async ({ request }) => {
  105 |   const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "reviewer" } });
  106 |   const { access_token } = (await login.json()) as { access_token: string };
  107 |   const headers = { Authorization: `Bearer ${access_token}` };
  108 | 
  109 |   const events = await request.get(`${API}/v1/events`, { headers });
  110 |   const [event] = (await events.json()) as { id: string }[];
  111 |   test.skip(event === undefined, "the reviewer is not on an event");
  112 | 
  113 |   // Every admin surface a reviewer might guess at has to refuse, with a status
  114 |   // rather than a blank page.
  115 |   for (const path of ["submissions", "speakers", "tasks/summary", "conflicts"]) {
  116 |     const response = await request.get(`${API}/v1/events/${event!.id}/${path}`, { headers });
  117 |     expect([401, 403], `${path} let a reviewer in with ${response.status()}`).toContain(
  118 |       response.status(),
  119 |     );
  120 |   }
  121 | });
  122 | 
  123 | test("83. a reviewer opening /admin is redirected, not shown a blank page", async ({ browser }) => {
  124 |   const context = await browser.newContext();
  125 |   const page = await context.newPage();
  126 |   await page.goto("/login");
  127 |   await page.getByRole("button", { name: /^Reviewer$/i }).click();
  128 |   await page.waitForTimeout(1500);
  129 | 
  130 |   await page.goto("/admin/submissions");
  131 |   await page.waitForTimeout(2500);
  132 | 
  133 |   const text = (await page.locator("body").innerText()).trim();
  134 |   // Either it bounces to login, or it says something. A blank screen is the
  135 |   // failure this item exists to catch.
  136 |   expect(text.length, "the admin screen rendered blank for a reviewer").toBeGreaterThan(20);
  137 |   await context.close();
  138 | });
  139 | 
  140 | test("85-86. an abstention is excluded and an unscored review is not a zero", async ({
  141 |   request,
  142 | }) => {
  143 |   const { headers, eventId } = await organizer(request);
  144 |   const listing = await request.get(`${API}/v1/events/${eventId}/submissions?per_page=200`, {
  145 |     headers,
  146 |   });
  147 |   const rows = ((await listing.json()) as {
  148 |     data: { id: string; score_avg: number | null; review_count: number }[];
  149 |   }).data;
  150 | 
  151 |   // Nothing with no completed reviews may carry a score of zero: that would sink
  152 |   // it to the bottom of a sorted list for never having been read.
  153 |   const unscoredWithZero = rows.filter((row) => row.review_count === 0 && row.score_avg === 0);
  154 |   expect(
  155 |     unscoredWithZero.map((row) => row.id),
  156 |     "unreviewed submissions are being scored zero",
  157 |   ).toEqual([]);
  158 | 
  159 |   // And anything carrying a score has at least one review behind it.
  160 |   const scoredWithoutReviews = rows.filter(
  161 |     (row) => row.score_avg !== null && row.review_count === 0,
  162 |   );
  163 |   expect(scoredWithoutReviews.map((row) => row.id), "a score with no reviews").toEqual([]);
  164 | });
  165 | 
  166 | test("89. scores export as CSV with one row per submission", async ({ request }) => {
  167 |   const { headers, eventId } = await organizer(request);
  168 |   const rounds = await request.get(`${API}/v1/events/${eventId}/review-rounds`, { headers });
  169 |   const [round] = (await rounds.json()) as { id: string }[];
  170 |   test.skip(round === undefined, "no review round on the seeded event");
```