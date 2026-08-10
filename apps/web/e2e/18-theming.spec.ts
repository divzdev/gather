import { expect, test, type Page } from "@playwright/test";

/** Dark mode actually being dark.
 *
 *  The portal hero shipped as a light-pink gradient across a dark page because
 *  the token file spelled `--heroA` lowercase and CSS custom property names are
 *  case-sensitive, so every `var(--heroA, #FFEDE9)` silently took its light
 *  fallback. `tools/check_tokens.py` catches that class statically; this catches
 *  what a person actually sees.
 */

const API = process.env.E2E_API_URL ?? "http://127.0.0.1:8051";

/** Perceived lightness, 0 (black) to 1 (white). */
function luminance(colour: string): number {
  const [r, g, b] = (colour.match(/\d+(\.\d+)?/g) ?? ["0", "0", "0"]).map(Number) as [
    number,
    number,
    number,
  ];
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

async function openPortal(page: Page, theme: "light" | "dark") {
  await page.goto("/login");
  await page.getByRole("button", { name: /^Speaker$/i }).click();
  await expect(page).toHaveURL(/\/portal/, { timeout: 20_000 });
  await page.evaluate((value) => {
    document.documentElement.setAttribute("data-theme", value);
  }, theme);
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 20_000 });
}

test.beforeAll(async ({ request }) => {
  const health = await request.get(`${API}/v1/health`).catch(() => null);
  test.skip(health === null || !health.ok(), `API not reachable at ${API}.`);
});

test("the portal hero follows the theme, and its heading stays readable on it", async ({ page }) => {
  for (const theme of ["light", "dark"] as const) {
    await openPortal(page, theme);

    const probe = await page.evaluate(() => {
      const heading = document.querySelector("h1") ?? document.querySelector("h2");
      const hero = heading?.closest("div[style*='gradient']");
      if (heading === null || hero == null) return null;
      const gradient = getComputedStyle(hero).backgroundImage;
      return {
        // Every colour stop in the hero's gradient, so a light-to-dark fade is
        // caught rather than only a uniformly wrong background.
        stops: gradient.match(/rgba?\([^)]*\)/g) ?? [],
        text: getComputedStyle(heading).color,
      };
    });
    expect(probe, "no hero gradient found behind the greeting").not.toBeNull();
    expect(probe!.stops.length, "the hero gradient has no colour stops").toBeGreaterThan(1);

    const stops = probe!.stops.map(luminance);
    const text = luminance(probe!.text);

    if (theme === "dark") {
      for (const [index, stop] of stops.entries()) {
        expect(stop, `hero gradient stop ${index} is light in dark mode`).toBeLessThan(0.3);
      }
      expect(text, "the greeting is dark text in dark mode").toBeGreaterThan(0.6);
    } else {
      for (const [index, stop] of stops.entries()) {
        expect(stop, `hero gradient stop ${index} is dark in light mode`).toBeGreaterThan(0.7);
      }
      expect(text, "the greeting is light text in light mode").toBeLessThan(0.4);
    }

    // Whatever the theme, the greeting has to stand off its background.
    const worst = Math.min(...stops.map((stop) => Math.abs(stop - text)));
    expect(worst, `the greeting barely separates from the hero in ${theme}`).toBeGreaterThan(0.4);
  }
});

test("a completed step still reads differently from one still to come", async ({ page }) => {
  // Both connectors were briefly the same neutral hairline in dark mode, which
  // makes the progress stepper decorative.
  await openPortal(page, "dark");

  const lines = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      done: root.getPropertyValue("--stepLn").trim(),
      todo: root.getPropertyValue("--ln").trim(),
    };
  });

  expect(lines.done, "--stepLn is not set in dark mode").not.toBe("");
  expect(lines.done, "a completed step looks identical to an unfinished one").not.toBe(lines.todo);
});
