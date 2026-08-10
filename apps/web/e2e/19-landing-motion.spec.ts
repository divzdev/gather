import { expect, test } from "@playwright/test";

/** The landing page's ported runtime and stylesheet.
 *
 *  `tools/dc2tsx.py` drops <style> and <script>, so everything the v6 landing
 *  prototype expresses through those two blocks — its breakpoints, its
 *  typography, and seven looping product demos — lives in hand-ported files
 *  that nothing else regenerates. Nothing type-checks the join between them
 *  and the generated markup: if a redesign renames a data-* hook or drops the
 *  `data-marketing` wrapper, the page still builds, still renders, and is
 *  quietly inert. This is what notices.
 *
 *  Deliberately not one assertion per demo. Each runs on its own multi-second
 *  loop and re-testing all seven would cost a minute for one shared failure
 *  mode; the runtime either mounted or it did not.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("the landing carries the scope its stylesheet and runtime hang off", async ({ page }) => {
  await expect(page.locator("[data-marketing]")).toHaveCount(1);
  // The one rule that proves the scope resolved: globals.css paints the page
  // console-light, and only marketing.css turns it to the near-black.
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe("rgb(8, 8, 10)");
});

test("the landing renders in its own typefaces, not the console's", async ({ page }) => {
  const faces = await page.evaluate(async () => {
    await document.fonts.ready;
    const heading = document.querySelector("[data-marketing] h1");
    const tokens = [...document.querySelectorAll<HTMLElement>("[data-marketing] *")].find(
      (element) => element.style.getPropertyValue("--bg"),
    );
    return {
      display: heading === null ? null : getComputedStyle(heading).fontFamily,
      body: tokens === undefined ? null : getComputedStyle(tokens).fontFamily,
      loaded: [...document.fonts].filter((font) => font.status === "loaded").length,
    };
  });
  expect(faces.display).toContain("Cabinet Grotesk");
  expect(faces.body).toContain("Switzer");
  // Self-hosted, so a machine with no network still gets the real thing.
  expect(faces.loaded).toBeGreaterThanOrEqual(8);
});

test("reveals fade without moving", async ({ page }) => {
  // A translate on stacked text overlaps it with its own in-flow siblings for
  // the length of the stagger. GatherDesign/CLAUDE.md records that being
  // reported twice, so the absence of a transform here is a requirement.
  const reveal = await page.evaluate(() => {
    const element = document.querySelector<HTMLElement>("[data-rv]");
    if (element === null) return null;
    return {
      transform: getComputedStyle(element).transform,
      transition: element.style.transition,
    };
  });
  expect(reveal?.transform).toBe("none");
  expect(reveal?.transition ?? "").not.toContain("transform");
});

test("the scripted demos run once scrolled to", async ({ page }) => {
  const host = page.locator("[data-fb]");
  await host.scrollIntoViewIfNeeded();

  const sample = () =>
    page.evaluate(() => ({
      drop: document.querySelector<HTMLElement>("[data-fb-drop]")?.style.transform ?? "",
      condition: document.querySelector<HTMLElement>("[data-fb-cond]")?.style.opacity ?? "",
      preview: document.querySelector<HTMLElement>("[data-fb-prev]")?.style.opacity ?? "",
    }));

  const seen = new Set<string>();
  for (let tick = 0; tick < 8; tick += 1) {
    seen.add(JSON.stringify(await sample()));
    await page.waitForTimeout(400);
  }
  expect(seen.size).toBeGreaterThan(1);
});

test("counts run up to their target", async ({ page }) => {
  await page.locator("[data-count]").first().scrollIntoViewIfNeeded();
  await expect
    .poll(
      async () =>
        page.$$eval("[data-count]", (elements) =>
          elements.every(
            (element) => element.textContent?.trim() === element.getAttribute("data-count"),
          ),
        ),
      { timeout: 5_000 },
    )
    .toBe(true);
});

test("a visitor who prefers less motion gets the finished frames", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator("[data-pal]").scrollIntoViewIfNeeded();

  const settled = await page.evaluate(() => ({
    typed: document.querySelector("[data-pal-text]")?.textContent,
    ghost: document.querySelector<HTMLElement>("[data-pal-ghost]")?.style.display,
    // Reveals must not be left at opacity 0 when the observer never animates.
    reveal: getComputedStyle(document.querySelector("[data-rv]") as Element).opacity,
  }));
  expect(settled.typed).toBe("agenda");
  expect(settled.ghost).toBe("none");
  expect(settled.reveal).toBe("1");
  await context.close();
});

test("the page fits every width without scrolling sideways", async ({ page }) => {
  // The nav list ships an inline `display:flex`, so the prototype's own
  // `[data-navlinks]{display:none}` loses to it and the header used to widen
  // the page by 111px at phone width. marketing.css overrides with !important.
  for (const width of [375, 700, 920, 1080, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(9999, 0));
    const overflow = await page.evaluate(() => window.scrollX);
    expect(overflow, `horizontal scroll at ${width}px`).toBe(0);
  }
});

test("the FAQ opens one answer at a time", async ({ page }) => {
  const questions = page.locator("[data-marketing] [aria-expanded]");
  await expect(questions).toHaveCount(8);
  await expect(questions.first()).toHaveAttribute("aria-expanded", "true");

  await questions.nth(2).click();
  await expect(questions.nth(2)).toHaveAttribute("aria-expanded", "true");
  await expect(questions.first()).toHaveAttribute("aria-expanded", "false");

  // Clicking the open one closes it rather than leaving it stuck open.
  await questions.nth(2).click();
  await expect(questions.nth(2)).toHaveAttribute("aria-expanded", "false");
});
