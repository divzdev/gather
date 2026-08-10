import { expect, test, type Page } from "@playwright/test";

/** Checklist §"Review setup" — item 64 onward. */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
const SLUG = "devflow-conf-2027";

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Organizer$/i }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 20_000 });
}

test("64. a stranger's submission reaches the organiser's list, awaiting review", async ({
  page,
  request,
}) => {
  // Submitted anonymously, exactly as section five does it, so this asserts the
  // handover rather than re-testing the form.
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

  const title = `Handover check ${Date.now()}`;
  const submitted = await request.post(`${API}/v1/public/events/${SLUG}/submissions`, {
    data: {
      form_id: form.form_id,
      title,
      answers,
      speaker_email: `handover-${Date.now()}@example.com`,
      speaker_name: "Handover Tester",
    },
  });
  expect(submitted.status(), await submitted.text()).toBe(201);

  await signIn(page);
  await page.goto("/admin/submissions");

  // It is in the list, by title, and carrying a status that is not a decision.
  const search = page.getByPlaceholder(/search/i).first();
  if ((await search.count()) > 0) {
    await search.fill(title);
    await page.waitForTimeout(800);
  }
  await expect(page.getByText(title, { exact: false }).first()).toBeVisible({ timeout: 20_000 });

  // What "pending" means is the submission's own state, not a string somewhere
  // on a page that also lists filter chips called "Accepted".
  const login = await request.post(`${API}/v1/auth/demo-login`, { data: { role: "organizer" } });
  const { access_token } = (await login.json()) as { access_token: string };
  const headers = { Authorization: `Bearer ${access_token}` };
  const events = await request.get(`${API}/v1/events`, { headers });
  const [event] = (await events.json()) as { id: string }[];

  const listing = await request.get(
    `${API}/v1/events/${event!.id}/submissions?per_page=200`,
    { headers },
  );
  const page_ = (await listing.json()) as {
    data: { title: string; status: string; decision_status: string }[];
  };
  const mine = page_.data.find((entry) => entry.title === title);

  expect(mine, "the submission is missing from the organiser's list").toBeDefined();
  expect(mine!.status).toBe("submitted");
  // 92 in advance: arriving is not being decided, and it is certainly not sent.
  expect(mine!.decision_status).toBe("none");
});
