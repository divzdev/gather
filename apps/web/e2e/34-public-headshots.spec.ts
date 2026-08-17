import { expect, test } from "@playwright/test";

/** Headshots on the public speaker page.
 *
 *  `API_BASE_URL` is two different things on purpose: the internal service
 *  address on the server, a relative path in the browser. That is right for a
 *  fetch the running process makes, and wrong for a URL the server only writes
 *  down for the browser to resolve later. This page put it in an `<img src>`
 *  during server rendering, so production shipped `https://api:8051/...` into
 *  the public HTML and every face rendered as a broken image.
 *
 *  It fails silently — the page still returns 200, the markup still has an
 *  `<img>`, and only a human looking at it sees anything wrong. So the assertion
 *  is on the resolved URL and on the image actually decoding.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";
const SLUG = "devflow-conf-2027";

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

test("a speaker headshot is served from a host the browser can reach", async ({ page }) => {
  await page.goto(`/e/${SLUG}/speakers`);
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

  const images = page.locator("img[src*='/photo']");
  const count = await images.count();
  test.skip(count === 0, "no published speaker carries a headshot in this database");

  const src = await images.first().getAttribute("src");
  expect(src, "no src on the headshot").not.toBeNull();

  // The exact production failure: an internal Docker service name, serialized
  // into public HTML by a server component.
  expect(src!, `headshot points at an internal host: ${src}`).not.toMatch(
    /^https?:\/\/(api|web|worker)[:/]/,
  );

  // And it has to actually decode, not merely look plausible.
  const decoded = await images.first().evaluate(async (node) => {
    const image = node as HTMLImageElement;
    if (!image.complete) await image.decode().catch(() => undefined);
    return { width: image.naturalWidth, height: image.naturalHeight };
  });
  expect(decoded.width, `headshot did not load (src ${src})`).toBeGreaterThan(0);
  expect(decoded.height).toBeGreaterThan(0);
});

test("a speaker with no headshot falls back to initials rather than a broken image", async ({
  page,
}) => {
  await page.goto(`/e/${SLUG}/speakers`);
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });

  // The seed deliberately leaves roughly one in seven without a photo, so the
  // fallback is exercised by real data rather than only in theory.
  const cards = page.locator("article, li, div").filter({ hasText: /·/ });
  expect(await cards.count(), "no speaker cards rendered at all").toBeGreaterThan(0);

  const broken = await page.locator("img[src*='/photo']").evaluateAll(
    (nodes) =>
      nodes.filter((node) => {
        const image = node as HTMLImageElement;
        return image.complete && image.naturalWidth === 0;
      }).length,
  );
  expect(broken, "some headshots rendered as broken images").toBe(0);
});
