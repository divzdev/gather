import { expect, test, type APIRequestContext } from "@playwright/test";

/** Checklist §"Bulk & data" — items 152-160.
 *
 *  These write to the shared seeded database, so anything created here is named
 *  with a run-unique marker and removed at the end. The one that cannot be
 *  undone cleanly — importing speakers — is checked for idempotency instead,
 *  which is the property item 154 actually asks about.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

async function organizer(request: APIRequestContext) {
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const [event] = (await events.json()) as { id: string; org_id: string }[];
  return { headers, eventId: event!.id, orgId: event!.org_id };
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

test("152-154. a CSV with one bad row imports the rest, and re-running adds nothing", async ({
  request,
}) => {
  const ctx = await organizer(request);
  const marker = `e2e${Date.now()}`;
  // Row 3 has no email at all, which is the row that must fail alone.
  const csv = [
    "name,email,company",
    `Ada ${marker},ada.${marker}@example.com,Analytical Engines`,
    `Broken ${marker},,No Email Ltd`,
    `Grace ${marker},grace.${marker}@example.com,COBOL Inc`,
  ].join("\n");

  const send = () =>
    request.post(`${API}/v1/orgs/${ctx.orgId}/directory/import`, {
      headers: ctx.headers,
      multipart: {
        file: { name: "speakers.csv", mimeType: "text/csv", buffer: Buffer.from(csv) },
      },
    });

  const first = await send();
  expect(first.status(), await first.text()).toBe(200);
  const result = (await first.json()) as {
    created: number;
    matched: number;
    skipped: number;
    errors: string[];
  };

  // 153. The good rows land...
  expect(result.created).toBe(2);
  // ...the bad one is reported by row number, not swallowed...
  expect(result.skipped).toBe(1);
  expect(result.errors.join(" ")).toMatch(/Row 3/);
  // ...and the file was not abandoned at the first problem.
  expect(result.errors.length).toBe(1);

  // 154. The identical file again: matched, not duplicated.
  const second = await send();
  const again = (await second.json()) as { created: number; matched: number };
  expect(again.created, "re-import created duplicates").toBe(0);
  expect(again.matched).toBe(2);

  const directory = await request.get(`${API}/v1/orgs/${ctx.orgId}/directory`, {
    headers: ctx.headers,
  });
  const rows = (await directory.json()) as { id: string; name: string; email: string }[];
  expect(rows.filter((row) => row.email.includes(marker))).toHaveLength(2);
});

test("155. sessions import from CSV, reporting each row it could not read", async ({ request }) => {
  const ctx = await organizer(request);
  const marker = `E2E ${Date.now()}`;

  const draft = await request.get(`${API}/v1/events/${ctx.eventId}/schedule/draft`, {
    headers: ctx.headers,
  });
  const [track] = ((await draft.json()) as { tracks: { id: string; name: string }[] }).tracks;
  expect(track, "the event has no tracks to import against").toBeDefined();

  const csv = [
    "title,track,duration_minutes,speakers",
    `${marker} Good,${track!.name},30,Ada Lovelace <ada.${Date.now()}@example.com>`,
    `${marker} Bad Track,No Such Track,30,`,
    `${marker} Bad Duration,${track!.name},9000,`,
    `${marker} Bad Speaker,${track!.name},30,not-an-email-at-all`,
  ].join("\n");

  const imported = await request.post(`${API}/v1/events/${ctx.eventId}/sessions/import`, {
    headers: ctx.headers,
    data: { csv_text: csv },
  });
  expect(imported.status(), await imported.text()).toBe(200);
  const result = (await imported.json()) as {
    created: number;
    updated: number;
    skipped: number;
    rows: { row: number; title: string; outcome: string; detail: string | null }[];
  };

  expect(result.created).toBe(1);
  expect(result.skipped).toBe(3);
  // Each refusal names the offending value, so the fix is obvious from the list.
  const reasons = result.rows.map((row) => row.detail ?? "").join(" | ");
  expect(reasons).toMatch(/No track named 'No Such Track'/);
  expect(reasons).toMatch(/between 5 and 600/);
  expect(reasons).toMatch(/Name <email@example.com>/);

  // Re-running corrects rather than duplicates, same as the speaker import.
  const rerun = await request.post(`${API}/v1/events/${ctx.eventId}/sessions/import`, {
    headers: ctx.headers,
    data: { csv_text: csv },
  });
  const second = (await rerun.json()) as { created: number; updated: number };
  expect(second.created, "re-import duplicated a session").toBe(0);
  expect(second.updated).toBe(1);

  // Clean up: the imported session is not part of the seeded fixture.
  const sessions = await request.get(`${API}/v1/events/${ctx.eventId}/sessions`, {
    headers: ctx.headers,
  });
  const mine = ((await sessions.json()) as { id: string; title: string }[]).filter((row) =>
    row.title.startsWith(marker),
  );
  expect(mine).toHaveLength(1);
  for (const row of mine) {
    await request.delete(`${API}/v1/events/${ctx.eventId}/sessions/${row.id}`, {
      headers: ctx.headers,
    });
  }
});

test("156. a bulk email resolves merge tags per recipient", async ({ request }) => {
  const ctx = await organizer(request);
  const directory = await request.get(`${API}/v1/orgs/${ctx.orgId}/directory`, {
    headers: ctx.headers,
  });
  const contacts = (await directory.json()) as { id: string; name: string }[];
  const targets = contacts.slice(0, 3);
  expect(targets.length).toBeGreaterThan(0);

  const subject = `Hello {{first_name}} — e2e ${Date.now()}`;
  const sent = await request.post(`${API}/v1/orgs/${ctx.orgId}/directory/email`, {
    headers: { ...ctx.headers, "Idempotency-Key": `bulk-${Date.now()}` },
    data: {
      speaker_ids: targets.map((row) => row.id),
      event_id: ctx.eventId,
      subject,
      body: "Hi {{first_name}} from {{company}}, we would love to have you back.",
    },
  });
  expect(sent.status(), await sent.text()).toBeLessThan(300);
  const result = (await sent.json()) as { sent: number };
  expect(result.sent).toBe(targets.length);

  // Every recipient got their own name, not the literal tag.
  const outbox = await request.get(`${API}/v1/events/${ctx.eventId}/messages/outbox?per_page=200`, {
    headers: ctx.headers,
  });
  const body = await outbox.text();
  expect(body, "a merge tag went out unresolved").not.toContain("{{first_name}}");
});

test("157-158. exports build server-side and refuse anonymous callers", async ({ request }) => {
  const ctx = await organizer(request);

  const listing = await request.get(`${API}/v1/events/${ctx.eventId}/submissions?per_page=5`, {
    headers: ctx.headers,
  });
  const ids = ((await listing.json()) as { data: { id: string }[] }).data.map((row) => row.id);

  for (const extension of ["csv", "xlsx"] as const) {
    const file = await request.post(
      `${API}/v1/events/${ctx.eventId}/submissions/export.${extension}`,
      { headers: ctx.headers, data: { submission_ids: ids } },
    );
    expect(file.status(), await file.text()).toBe(200);
    const bytes = Buffer.from(await file.body());

    if (extension === "xlsx") {
      // A real workbook is a zip; "PK" is the signature Excel looks for. A JSON
      // error page would also be 200-shaped to a naive check.
      expect(bytes.subarray(0, 2).toString()).toBe("PK");
      expect(bytes.length).toBeGreaterThan(3000);
    } else {
      expect(bytes.toString("utf8").split("\n")[0]).toContain("code,title,speakers");
      // Header plus one line per requested id.
      expect(bytes.toString("utf8").trim().split("\n")).toHaveLength(ids.length + 1);
    }

    // And an export is not a public URL.
    const anonymous = await request.post(
      `${API}/v1/events/${ctx.eventId}/submissions/export.${extension}`,
      { data: { submission_ids: ids } },
    );
    expect(anonymous.status(), "an export answered without credentials").toBe(401);
  }

  // 157. The deliverables archive is a zip too, and equally guarded.
  const zip = await request.get(`${API}/v1/events/${ctx.eventId}/tasks/download.zip`, {
    headers: ctx.headers,
  });
  expect(zip.status()).toBe(200);
  expect(Buffer.from(await zip.body()).subarray(0, 2).toString()).toBe("PK");
  const openZip = await request.get(`${API}/v1/events/${ctx.eventId}/tasks/download.zip`);
  expect(openZip.status()).toBe(401);
});

test("159. a directory contact pushes into the event roster", async ({ request }) => {
  const ctx = await organizer(request);
  const marker = `push${Date.now()}`;

  const added = await request.post(`${API}/v1/orgs/${ctx.orgId}/directory`, {
    headers: ctx.headers,
    data: { name: `Pushed ${marker}`, email: `${marker}@example.com` },
  });
  expect(added.status(), await added.text()).toBe(201);
  const contact = (await added.json()) as { id: string };

  const pushed = await request.post(
    `${API}/v1/orgs/${ctx.orgId}/directory/${contact.id}/push`,
    { headers: ctx.headers, data: { event_id: ctx.eventId } },
  );
  expect(pushed.status(), await pushed.text()).toBeLessThan(300);

  const roster = await request.get(`${API}/v1/events/${ctx.eventId}/speakers`, {
    headers: ctx.headers,
  });
  const rows = (await roster.json()) as { id: string; email: string }[];
  const mine = rows.find((row) => row.email === `${marker}@example.com`);
  expect(mine, "the contact never reached the roster").toBeDefined();

  // Pushing twice does not create a second participation.
  await request.post(`${API}/v1/orgs/${ctx.orgId}/directory/${contact.id}/push`, {
    headers: ctx.headers,
    data: { event_id: ctx.eventId },
  });
  const after = await request.get(`${API}/v1/events/${ctx.eventId}/speakers`, {
    headers: ctx.headers,
  });
  const dupes = ((await after.json()) as { email: string }[]).filter(
    (row) => row.email === `${marker}@example.com`,
  );
  expect(dupes).toHaveLength(1);

  await request.delete(`${API}/v1/events/${ctx.eventId}/speakers/${mine!.id}`, {
    headers: ctx.headers,
  });
});

test("160. one field set across five sessions, and locked ones left alone", async ({ request }) => {
  const ctx = await organizer(request);

  const listing = await request.get(`${API}/v1/events/${ctx.eventId}/sessions`, {
    headers: ctx.headers,
  });
  const sessions = (await listing.json()) as {
    id: string;
    track_id: string | null;
    content_status: string;
  }[];
  const five = sessions.slice(0, 5);
  expect(five).toHaveLength(5);
  const before = new Map(five.map((row) => [row.id, row.content_status]));

  const applied = await request.post(`${API}/v1/events/${ctx.eventId}/sessions/bulk`, {
    headers: ctx.headers,
    data: { session_ids: five.map((row) => row.id), content_status: "changes_requested" },
  });
  expect(applied.status(), await applied.text()).toBe(200);
  const result = (await applied.json()) as { updated: number; skipped_locked: number };
  expect(result.updated + result.skipped_locked).toBe(5);

  const after = await request.get(`${API}/v1/events/${ctx.eventId}/sessions`, {
    headers: ctx.headers,
  });
  const changed = ((await after.json()) as { id: string; content_status: string; is_locked: boolean }[])
    .filter((row) => before.has(row.id));
  for (const row of changed) {
    if (!row.is_locked) expect(row.content_status).toBe("changes_requested");
  }

  // An empty selection is a mistake, not a no-op that silently touches nothing.
  const empty = await request.post(`${API}/v1/events/${ctx.eventId}/sessions/bulk`, {
    headers: ctx.headers,
    data: { session_ids: [], content_status: "approved" },
  });
  expect(empty.status()).toBe(422);

  // Naming no field to change is likewise refused rather than reported as
  // "updated 5" — a bulk action that did nothing must never claim it did.
  const nothing = await request.post(`${API}/v1/events/${ctx.eventId}/sessions/bulk`, {
    headers: ctx.headers,
    data: { session_ids: five.map((row) => row.id) },
  });
  expect(nothing.status()).toBe(422);

  // Put the fixture back exactly as it was.
  for (const [id, status] of before) {
    await request.post(`${API}/v1/events/${ctx.eventId}/sessions/${id}/approval`, {
      headers: ctx.headers,
      data: { content_status: status },
    });
  }
});
