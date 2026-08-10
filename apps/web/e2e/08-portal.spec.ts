import { expect, test, type APIRequestContext } from "@playwright/test";

/** Checklist §"Speaker portal" — items 99-115. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

async function speakerToken(request: APIRequestContext): Promise<string> {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "speaker" } });
  expect(login.status(), await login.text()).toBe(200);
  return ((await login.json()) as { access_token: string }).access_token;
}

async function organizer(request: APIRequestContext) {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const [event] = (await events.json()) as { id: string }[];
  return { headers, eventId: event!.id };
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

test("99-101. a speaker signs in with no password and sees their own everything", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Speaker$/i }).click();
  await expect(page).toHaveURL(/\/portal/, { timeout: 20_000 });

  const body = await page.locator("body").innerText();
  // 100. Event, tasks and progress in one payload, on one screen.
  expect(body).toMatch(/DevFlow|AI Engineer/i);
  expect(body.toLowerCase()).toMatch(/task|waiting on you|outstanding|nothing/);
});

test("107. a speaker cannot reach another speaker's task or file", async ({ request }) => {
  const mine = await speakerToken(request);
  const headers = { Authorization: `Bearer ${mine}` };

  const home = await request.get(`${API}/v1/portal/home`, { headers });
  expect(home.status()).toBe(200);
  const own = (await home.json()) as { speaker: { id: string }; tasks: { id: string }[] };

  // Someone else's task id, taken from the organiser's view of the whole event.
  const ctx = await organizer(request);
  const summary = await request.get(`${API}/v1/events/${ctx.eventId}/tasks/summary`, {
    headers: ctx.headers,
  });
  const rows = (await summary.json()) as { id: string; speaker_id: string }[];
  const theirs = rows.find((row) => row.speaker_id !== own.speaker.id);
  expect(theirs, "the event has only one speaker with tasks").toBeDefined();

  const trespass = await request.get(`${API}/v1/portal/tasks/${theirs!.id}`, { headers });
  expect(trespass.status(), "a speaker read another speaker's task").toBe(404);
});

test("105. a speaker edits their bio and it sticks", async ({ request }) => {
  const token = await speakerToken(request);
  const headers = { Authorization: `Bearer ${token}` };
  const original = ((await (await request.get(`${API}/v1/portal/profile`, { headers })).json()) as {
    bio: string | null;
  }).bio;

  const bio = `Checked by Playwright at ${Date.now()}.`;
  const saved = await request.patch(`${API}/v1/portal/profile`, { headers, data: { bio } });
  expect(saved.status(), await saved.text()).toBe(200);

  const again = await request.get(`${API}/v1/portal/profile`, { headers });
  expect(((await again.json()) as { bio: string }).bio).toBe(bio);

  await request.patch(`${API}/v1/portal/profile`, { headers, data: { bio: original } });
});

test("102+106. an upload lands, and replacing it keeps the earlier version", async ({
  request,
}) => {
  const token = await speakerToken(request);
  const headers = { Authorization: `Bearer ${token}` };
  const home = await request.get(`${API}/v1/portal/home`, { headers });
  const tasks = ((await home.json()) as {
    tasks: { id: string; kind: string; accepted_file_types: { extensions?: string[] } }[];
  }).tasks;
  const upload = tasks.find((task) => task.kind === "upload");
  test.skip(upload === undefined, "this speaker has no upload task");

  const extension = upload!.accepted_file_types.extensions?.[0] ?? "pdf";
  const send = async (contents: string) =>
    request.post(`${API}/v1/portal/tasks/${upload!.id}/files`, {
      headers,
      multipart: {
        file: {
          name: `deck.${extension}`,
          mimeType: extension === "pdf" ? "application/pdf" : "image/jpeg",
          buffer: Buffer.from(contents),
        },
      },
    });

  const first = await send("first version");
  expect(first.status(), await first.text()).toBe(201);
  const second = await send("second version");
  expect(second.status(), await second.text()).toBe(201);

  const files = ((await second.json()) as { files: { id: string; version: number }[] }).files;
  const versions = files.map((file) => file.version).sort();
  expect(versions.length, "replacing a file should keep the earlier one").toBeGreaterThanOrEqual(2);

  // 106. The earlier version is still downloadable, not overwritten.
  const oldest = files.reduce((low, file) => (file.version < low.version ? file : low), files[0]!);
  const download = await request.get(`${API}/v1/portal/files/${oldest.id}`, { headers });
  expect(download.status()).toBe(200);
});

test("104. an acknowledge task completes from the portal", async ({ request }) => {
  const token = await speakerToken(request);
  const headers = { Authorization: `Bearer ${token}` };
  const home = await request.get(`${API}/v1/portal/home`, { headers });
  const tasks = ((await home.json()) as { tasks: { id: string; kind: string }[] }).tasks;
  const ack = tasks.find((task) => task.kind === "acknowledge");
  test.skip(ack === undefined, "this speaker has no acknowledge task");

  const done = await request.put(`${API}/v1/portal/tasks/${ack!.id}`, {
    headers,
    data: { acknowledged: true },
  });

  expect(done.status(), await done.text()).toBe(200);
  expect(((await done.json()) as { status: string }).status).toBe("complete");
});

test("108. the session downloads as a calendar entry with a real time", async ({ request }) => {
  const token = await speakerToken(request);
  const headers = { Authorization: `Bearer ${token}` };
  const home = await request.get(`${API}/v1/portal/home`, { headers });
  const body = (await home.json()) as {
    sessions: { id: string; starts_at: string | null }[];
  };
  const talk = body.sessions.find((session) => session.starts_at !== null);
  test.skip(talk === undefined, "this speaker has no scheduled session");

  // Their own route: the public one only knows what has been published, and a
  // speaker needs the time from the moment they are scheduled.
  const ics = await request.get(`${API}/v1/portal/sessions/${talk!.id}.ics`, { headers });

  expect(ics.status()).toBe(200);
  const text = await ics.text();
  expect(text).toContain("BEGIN:VEVENT");
  expect(text, "the entry has no start time").toMatch(/DTSTART:\d{8}T\d{6}Z/);
});

test("112-115. the task board chases, and a second nudge does not double-send", async ({
  request,
}) => {
  const ctx = await organizer(request);

  const summary = await request.get(`${API}/v1/events/${ctx.eventId}/tasks/summary`, {
    headers: ctx.headers,
  });
  const rows = (await summary.json()) as { status: string; speaker_name: string }[];
  expect(rows.length, "nothing on the task board").toBeGreaterThan(0);
  // 112. Overdue exists and is visible as its own state, not folded into "open".
  expect(rows.some((row) => row.status === "overdue")).toBe(true);

  const first = await request.post(`${API}/v1/events/${ctx.eventId}/tasks/nudge`, {
    headers: ctx.headers,
    data: {},
  });
  const second = await request.post(`${API}/v1/events/${ctx.eventId}/tasks/nudge`, {
    headers: ctx.headers,
    data: {},
  });

  const one = (await first.json()) as { sent: number; skipped: number };
  const two = (await second.json()) as { sent: number; skipped: number };

  // 115. Pressing it twice must not email anyone twice.
  expect(two.sent, "the second nudge sent again").toBe(0);
  expect(two.skipped, "the second nudge skipped nobody").toBeGreaterThan(0);
  expect(one.sent + one.skipped).toBeGreaterThan(0);
});
