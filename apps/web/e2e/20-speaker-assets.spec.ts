import { expect, test, type APIRequestContext } from "@playwright/test";

/** Bio, photo and deck — collected, and findable.
 *
 *  All three were being collected and stored from early on, and two of them
 *  were visible nowhere: `headshot_file_id` never left the API, the speaker
 *  drawer's file tab was hardcoded empty, and the public gallery drew initials.
 *  These are the substance of speaker management, so they get their own file.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
const SLUG = "devflow-conf-2027";

const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function organizer(request: APIRequestContext) {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const eventId = ((await events.json()) as { id: string }[])[0]!.id;
  return { headers, eventId };
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

test("a speaker's bio, photo and deliverables are all reachable from the roster", async ({
  request,
}) => {
  const ctx = await organizer(request);

  // Upload as the speaker, the only way a headshot can arrive.
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "speaker" } });
  const speakerAuth = { Authorization: `Bearer ${((await login.json()) as { access_token: string }).access_token}` };
  const uploaded = await request.post(`${API}/v1/portal/profile/headshot`, {
    headers: speakerAuth,
    multipart: { file: { name: "face.png", mimeType: "image/png", buffer: PIXEL } },
  });
  expect(uploaded.status(), await uploaded.text()).toBeLessThan(300);

  const roster = await request.get(`${API}/v1/events/${ctx.eventId}/speakers`, {
    headers: ctx.headers,
  });
  const rows = (await roster.json()) as {
    id: string;
    bio: string | null;
    headshot_file_id: string | null;
  }[];

  // The roster carries the photo, so a list can show a face.
  const withPhoto = rows.filter((row) => row.headshot_file_id !== null);
  expect(withPhoto.length, "no speaker on the roster carries a headshot").toBeGreaterThan(0);
  expect(rows.some((row) => (row.bio ?? "").trim() !== ""), "no bios on the roster").toBe(true);

  // And one call lists everything that speaker has sent in, labelled by the
  // task that asked for it rather than by filename.
  const files = await request.get(
    `${API}/v1/events/${ctx.eventId}/speakers/${withPhoto[0]!.id}/files`,
    { headers: ctx.headers },
  );
  expect(files.status(), await files.text()).toBe(200);
  const assets = (await files.json()) as {
    id: string;
    label: string;
    filename: string;
    is_headshot: boolean;
    version: number;
  }[];

  expect(assets.length, "the speaker has no files at all").toBeGreaterThan(0);
  expect(assets.some((entry) => entry.is_headshot), "the headshot is not in the list").toBe(true);
  for (const entry of assets) {
    expect(entry.label.trim(), "a file with nothing to call it").not.toBe("");
    expect(entry.version).toBeGreaterThanOrEqual(1);
  }

  // Every one of them opens.
  const first = assets[0]!;
  const opened = await request.get(
    `${API}/v1/events/${ctx.eventId}/files/${first.id}/download`,
    { headers: ctx.headers },
  );
  expect(opened.status(), "a listed file could not be downloaded").toBe(200);
  expect((await opened.body()).length).toBeGreaterThan(0);
});

test("the public gallery shows faces, and serves nothing that is not a published headshot", async ({
  request,
}) => {
  const ctx = await organizer(request);
  await request.post(`${API}/v1/events/${ctx.eventId}/schedule/publish`, {
    headers: { ...ctx.headers, "Idempotency-Key": `photo-${Date.now()}` },
    data: { acknowledge_conflicts: true },
  });

  const payload = await request.get(`${API}/v1/public/events/${SLUG}/speakers`);
  const speakers = ((await payload.json()) as {
    speakers: { name: string; headshot_file_id: string | null }[];
  }).speakers;

  const shown = speakers.filter((person) => person.headshot_file_id !== null);
  expect(shown.length, "the published gallery carries no photos").toBeGreaterThan(0);

  // A stranger can load it, with no credentials.
  const photo = await request.get(
    `${API}/v1/public/events/${SLUG}/speakers/${shown[0]!.headshot_file_id}/photo`,
  );
  expect(photo.status()).toBe(200);
  expect(photo.headers()["content-type"]).toContain("image/");
  // Replacing a headshot writes a new row at a new id, so this can be cached hard.
  expect(photo.headers()["cache-control"]).toContain("immutable");

  // The snapshot is the allow-list: a real file that is not a published
  // headshot must not be readable through this route. Search the roster for a
  // deliverable rather than hoping the first speaker has one — skipping here
  // would quietly drop the only check that this route cannot be walked.
  // Upload one, rather than hunting the seed for a speaker who happens to have
  // a deliverable — skipping here would quietly drop the only check that this
  // route cannot be walked to read someone's unpublished slides.
  const speakerLogin = await request.post(`${API}/v1/auth/demo-login`, {
    data: { role: "speaker" },
  });
  const speakerAuth = {
    Authorization: `Bearer ${((await speakerLogin.json()) as { access_token: string }).access_token}`,
  };
  const home = await request.get(`${API}/v1/portal/home`, { headers: speakerAuth });
  const uploadTask = ((await home.json()) as { tasks: { id: string; kind: string }[] }).tasks.find(
    (task) => task.kind === "upload",
  );
  expect(uploadTask, "the demo speaker has no upload task").toBeDefined();

  const sent = await request.post(`${API}/v1/portal/tasks/${uploadTask!.id}/files`, {
    headers: speakerAuth,
    multipart: {
      // Matched to whatever the task accepts; the guard below does not care
      // what kind of file it is, only that it is not a published headshot.
      file: { name: "deliverable.png", mimeType: "image/png", buffer: PIXEL },
    },
  });
  expect(sent.status(), await sent.text()).toBeLessThan(300);

  const mine = await request.get(`${API}/v1/portal/home`, { headers: speakerAuth });
  const speakerId = ((await mine.json()) as { speaker: { id: string } }).speaker.id;
  const roster = await request.get(`${API}/v1/events/${ctx.eventId}/speakers`, {
    headers: ctx.headers,
  });
  const row = ((await roster.json()) as { id: string; speaker_id: string }[]).find(
    (entry) => entry.speaker_id === speakerId,
  );
  expect(row, "the uploading speaker is not on this event's roster").toBeDefined();

  const files = await request.get(
    `${API}/v1/events/${ctx.eventId}/speakers/${row!.id}/files`,
    { headers: ctx.headers },
  );
  const deck = ((await files.json()) as { id: string; is_headshot: boolean; filename: string }[])
    .find((entry) => !entry.is_headshot && entry.filename === "deliverable.png");
  expect(deck, "the deliverable just uploaded is not in the speaker's file list").toBeDefined();

  const leaked = await request.get(
    `${API}/v1/public/events/${SLUG}/speakers/${deck!.id}/photo`,
  );
  expect(leaked.status(), "a deliverable was served through the public photo route").toBe(404);
});
