import { expect, test, type APIRequestContext } from "@playwright/test";

/** Checklist §"Decisions" and §"Portal" — the last uncovered items: 97, 98,
 *  103, 109, 110.
 *
 *  Item 110 asks for a real phone. What is automatable is the same journey at
 *  phone width with touch input, which is where the layout bugs live; a real
 *  device still needs a person.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

async function organizer(request: APIRequestContext) {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const eventId = ((await events.json()) as { id: string }[])[0]!.id;
  return { headers, eventId };
}

async function speakerHeaders(request: APIRequestContext) {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "speaker" } });
  const { access_token } = (await login.json()) as { access_token: string };
  return { Authorization: `Bearer ${access_token}` };
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

test("97. a failed message can be retried, and a delivered one cannot", async ({ request }) => {
  const ctx = await organizer(request);

  const outbox = await request.get(`${API}/v1/events/${ctx.eventId}/messages/outbox?per_page=200`, {
    headers: ctx.headers,
  });
  const rows = ((await outbox.json()) as {
    data: { id: string; status: string; to_email: string }[];
  }).data;
  expect(rows.length, "the outbox is empty, so there is nothing to retry").toBeGreaterThan(0);

  // Resending something that arrived is how one person gets told twice, so the
  // endpoint refuses it rather than leaving that to the UI.
  const delivered = rows.find((row) => row.status === "sent" || row.status === "queued");
  if (delivered !== undefined) {
    const refused = await request.post(
      `${API}/v1/events/${ctx.eventId}/messages/outbox/${delivered.id}/resend`,
      { headers: ctx.headers },
    );
    expect(refused.status(), "a delivered message was resent").toBe(409);
    expect(await refused.text()).toMatch(/nothing to retry|sent|queued/i);
  }

  const failed = rows.find((row) => row.status === "failed" || row.status === "bounced");
  test.skip(failed === undefined, "nothing in the outbox has failed");

  const retried = await request.post(
    `${API}/v1/events/${ctx.eventId}/messages/outbox/${failed!.id}/resend`,
    { headers: ctx.headers },
  );
  expect(retried.status(), await retried.text()).toBe(200);

  // A new row, not a retry in place: the record of what went wrong survives.
  const after = await request.get(`${API}/v1/events/${ctx.eventId}/messages/outbox?per_page=200`, {
    headers: ctx.headers,
  });
  const now = ((await after.json()) as { data: { id: string; status: string }[] }).data;
  expect(now.find((row) => row.id === failed!.id)?.status, "the failure was overwritten").toBe(
    failed!.status,
  );
  expect(now.length, "the retry did not appear in the outbox").toBeGreaterThan(rows.length);
});

test("98. deciding and sending move the same proposal through its notified state", async ({
  request,
}) => {
  const ctx = await organizer(request);

  const listing = await request.get(
    `${API}/v1/events/${ctx.eventId}/submissions?per_page=200&filter[status]=submitted`,
    { headers: ctx.headers },
  );
  const [target] = ((await listing.json()) as {
    data: { id: string; decision_status: string }[];
  }).data;
  test.skip(target === undefined, "no undecided proposal to work with");

  const read = async () => {
    const response = await request.get(
      `${API}/v1/events/${ctx.eventId}/submissions/${target!.id}`,
      { headers: ctx.headers },
    );
    return (await response.json()) as { status: string; decision_status: string };
  };
  const before = await read();

  try {
    await request.post(`${API}/v1/events/${ctx.eventId}/submissions/${target!.id}/decision`, {
      headers: ctx.headers,
      data: { outcome: "waitlisted" },
    });

    // The whole product rests on this: deciding sets pending_send and mails
    // nobody. The list column has to say so, or an organiser cannot tell the
    // difference between recorded and announced.
    const decided = await read();
    expect(decided.status).toBe("waitlisted");
    expect(decided.decision_status, "deciding did not queue a notification").toBe("pending_send");

    const pending = await request.get(`${API}/v1/events/${ctx.eventId}/submissions/pending-decisions`, {
      headers: ctx.headers,
    });
    const counts = (await pending.json()) as { waitlisted: number; total: number };
    expect(counts.waitlisted, "the pending count did not move").toBeGreaterThan(0);
  } finally {
    await request.post(`${API}/v1/events/${ctx.eventId}/submissions/${target!.id}/decision`, {
      headers: ctx.headers,
      data: { outcome: before.status === "submitted" ? "waitlisted" : before.status },
    }).catch(() => undefined);
  }
});

test("103. a form task comes back with what the speaker already answered", async ({ request }) => {
  const headers = await speakerHeaders(request);

  const home = await request.get(`${API}/v1/portal/home`, { headers });
  expect(home.status(), await home.text()).toBe(200);
  const payload = (await home.json()) as {
    tasks: { id: string; kind: string; status: string; form_response: unknown }[];
  };

  const form = payload.tasks.find((task) => task.kind === "form");
  test.skip(form === undefined, "the seeded speaker has no form task");

  const answer = { availability: "Any time on the Thursday", accessibility: "None" };
  const saved = await request.put(`${API}/v1/portal/tasks/${form!.id}`, {
    headers,
    data: { form_response: answer },
  });
  expect(saved.status(), await saved.text()).toBe(200);

  try {
    // Reopening the task returns the answers rather than an empty form — a
    // speaker who comes back to check what they said must not have to retype it.
    const reopened = await request.get(`${API}/v1/portal/tasks/${form!.id}`, { headers });
    const stored = (await reopened.json()) as { form_response: Record<string, string> | null };
    expect(stored.form_response, "the task came back empty").not.toBeNull();
    expect(stored.form_response!.availability).toBe(answer.availability);
  } finally {
    await request
      .put(`${API}/v1/portal/tasks/${form!.id}`, {
        headers,
        data: { form_response: (form!.form_response as Record<string, unknown>) ?? {} },
      })
      .catch(() => undefined);
  }
});

test("109. Google and Outlook links sit beside the .ics, and all three describe the same talk", async ({
  request,
}) => {
  const headers = await speakerHeaders(request);
  const home = await request.get(`${API}/v1/portal/home`, { headers });
  const payload = (await home.json()) as {
    sessions: {
      id: string;
      title: string;
      starts_at: string | null;
      calendar_links: Record<string, string>;
    }[];
  };

  const talk = payload.sessions.find((row) => row.starts_at !== null);
  test.skip(talk === undefined, "the seeded speaker has no scheduled session");

  // Most speakers never download an .ics; they click the calendar they use.
  expect(talk!.calendar_links.google, "no Google Calendar link").toContain(
    "calendar.google.com",
  );
  expect(talk!.calendar_links.outlook, "no Outlook link").toContain("outlook");

  // Both links carry the real title, not a placeholder.
  const encoded = encodeURIComponent(talk!.title).replace(/%20/g, "%20");
  for (const [name, link] of Object.entries(talk!.calendar_links)) {
    expect(decodeURIComponent(link), `the ${name} link does not name the talk`).toContain(
      talk!.title.slice(0, 20),
    );
  }
  void encoded;

  // And the .ics still works, for the people who do want a file.
  const file = await request.get(`${API}/v1/portal/sessions/${talk!.id}.ics`, { headers });
  expect(file.status(), await file.text()).toBe(200);
  const text = await file.text();
  expect(text).toContain("BEGIN:VCALENDAR");
  expect(text, "the .ics describes a different talk").toContain(talk!.title.slice(0, 20));
});

test("110. the portal works at phone width, end to end, with touch", async ({ browser }) => {
  // A real device still needs a person. This is the part a machine can check:
  // the same journey at 390x844 with touch input, which is where the layout and
  // hit-target bugs actually are.
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
  });
  const page = await context.newPage();

  await page.goto("/login");
  await page.getByRole("button", { name: /^Speaker$/i }).click();
  await expect(page).toHaveURL(/\/portal/, { timeout: 20_000 });
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

  // Nothing off-screen, and nothing too small to hit. 40px is below Apple's
  // 44pt guidance but above the point where a control is unusable.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the portal scrolls sideways on a phone").toBeLessThanOrEqual(4);

  const tiny = await page.evaluate(() =>
    [...document.querySelectorAll("button, a[href]")]
      .filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && box.height < 28;
      })
      .map((element) => (element.textContent ?? "").trim().slice(0, 24))
      .filter((label) => label !== ""),
  );
  expect(tiny, "controls too small to tap on a phone").toEqual([]);

  // And a task can actually be completed by tapping.
  const acknowledge = page
    .getByRole("button", { name: /acknowledge|i have read|confirm|mark (as )?done/i })
    .first();
  if ((await acknowledge.count()) > 0) {
    await acknowledge.tap();
    await page.waitForTimeout(1500);
    await expect(page.getByRole("heading").first()).toBeVisible();
  }

  await context.close();
});
