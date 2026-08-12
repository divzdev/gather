import { expect, test } from "@playwright/test";

/** The landing page's ported stylesheet and its links.
 *
 *  `tools/dc2tsx.py` drops <style> and <script>, so everything the prototype
 *  expresses through those two blocks — its palette, its breakpoints, its
 *  keyframes — lives in `styles/marketing.css`, mechanically rewritten so every
 *  selector sits under `[data-marketing]`. Nothing type-checks the join between
 *  that file and the generated markup: if a redesign drops the wrapper or
 *  renames a hook, the page still builds, still renders, and is quietly inert
 *  or quietly leaking its `body` rules into the console. This is what notices.
 *
 *  Rewritten wholesale when the v11 design landed. The previous page drove seven
 *  product vignettes from JavaScript; this one animates them in CSS, so the
 *  tests that poked at `[data-fb-drop]` and `[data-pal-text]` were testing a
 *  page that no longer exists.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("the landing carries the scope its stylesheet hangs off", async ({ page }) => {
  const scope = page.locator("[data-marketing]");
  await expect(scope).toHaveCount(1);

  // The one rule that proves the scope resolved. The prototype paints this on
  // `body`; scoped, it lands on the wrapper instead, and if the selector ever
  // fails to match, the page renders console-light with white-on-white text.
  await expect(scope).toHaveCSS("background-color", "rgb(7, 8, 14)");
});

test("the marketing stylesheet does not escape into the console", async ({ page }) => {
  // The prototype styles `body`, `a`, `h1` and `nav` globally, because in the
  // design tool it is the only thing on the page. One unscoped selector would
  // repaint every console screen in near-black.
  await page.goto("/login");
  const leaked = await page.evaluate(() => {
    const probe = document.createElement("p");
    probe.textContent = "probe";
    document.body.append(probe);
    const size = getComputedStyle(probe).fontSize;
    probe.remove();
    return { bodyFont: size, marketing: document.querySelectorAll("[data-marketing]").length };
  });
  expect(leaked.marketing).toBe(0);
  // marketing.css sets 17px on its own root. A console page must not inherit it.
  expect(leaked.bodyFont).not.toBe("17px");
});

test("the landing renders in its own typeface, not the console's", async ({ page }) => {
  const faces = await page.evaluate(async () => {
    await document.fonts.ready;
    const heading = document.querySelector("[data-marketing] h1");
    return heading === null ? null : getComputedStyle(heading).fontFamily;
  });
  // next/font hashes the family name, so the literal never appears verbatim —
  // which is exactly the trap that made the previous stylesheet fall back to
  // Segoe UI without anything failing.
  expect(faces?.toLowerCase()).toContain("manrope");
});

test("every call to action goes somewhere", async ({ page }) => {
  // The prototype ships its links as `href="#"` placeholders, including both
  // halves of the final CTA — the section the nav pill and the hero button both
  // scroll to. A landing page whose only route into the product does nothing is
  // the most expensive defect this page can have, and it is invisible.
  const dead = await page.$$eval("[data-marketing] a", (anchors) =>
    anchors
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .filter((href) => href === "" || href === "#"),
  );
  expect(dead, "links with no destination").toEqual([]);

  // And the in-page anchors have to land on something.
  const broken = await page.$$eval("[data-marketing] a[href^='#']", (anchors) =>
    anchors
      .map((anchor) => (anchor.getAttribute("href") ?? "").slice(1))
      .filter((id) => id !== "" && document.getElementById(id) === null),
  );
  expect(broken, "in-page anchors with no target").toEqual([]);
});

test("the photographs are served from this repo, at a sane weight", async ({ page }) => {
  // They arrived as three 2.7 MB PNGs on a third-party CDN: a referrer leak on
  // every visit, a blank page on a machine with no network, and five times the
  // whole page's byte budget on their own.
  const images = await page.$$eval("[data-marketing] img", (nodes) =>
    nodes.map((node) => (node as HTMLImageElement).getAttribute("src") ?? ""),
  );
  expect(images.length).toBeGreaterThan(0);
  expect(
    images.filter((src) => /^https?:/.test(src)),
    "off-site images",
  ).toEqual([]);

  let bytes = 0;
  for (const src of images) {
    const response = await page.request.get(src);
    expect(response.ok(), `${src} does not resolve`).toBe(true);
    bytes += (await response.body()).length;
  }
  expect(bytes, "the landing's photography is too heavy").toBeLessThan(600_000);
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

test("a visitor who prefers less motion still gets the finished page", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await page.locator("[data-rv]").last().scrollIntoViewIfNeeded();

  // Reveals must not be left at opacity 0 when the observer never animates —
  // the failure mode is a page that is simply blank below the fold.
  const opacities = await page.$$eval("[data-marketing] [data-rv]", (elements) =>
    elements.map((element) => getComputedStyle(element).opacity),
  );
  expect(
    opacities.filter((value) => value !== "1"),
    "reveals stuck invisible",
  ).toEqual([]);
  await context.close();
});

test("the page fits every width without scrolling sideways", async ({ page }) => {
  for (const width of [375, 700, 920, 1080, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => window.scrollTo(9999, 0));
    const overflow = await page.evaluate(() => window.scrollX);
    expect(overflow, `horizontal scroll at ${width}px`).toBe(0);
  }
});


/** Contrast and hit areas, measured off the rendered page at both widths.
 *
 *  This exists because the round trip broke exactly once and silently. The
 *  landing's stylesheet is generated from the prototype by `tools/dcstyle.py`,
 *  and a contrast fix applied to the *generated* file was reverted by the next
 *  regeneration — the colour went back to 3.31:1 across eleven pieces of page
 *  copy with nothing failing and no diff to notice. A source-of-truth pipeline
 *  makes that class of regression invisible, so it needs a test rather than a
 *  reviewer.
 *
 *  Colours are read from `getComputedStyle` on each rendered text node with the
 *  background composited up the ancestor chain. No token is resolved anywhere:
 *  a fixed-dark surface whose `var()` falls back to a literal would otherwise
 *  report a phantom pass.
 *
 *  `aria-hidden` subtrees are skipped on purpose. The product mockups are
 *  illustration — depictions of a UI, not copy — and their 10px labels are
 *  texture at a glance rather than something anyone is asked to read.
 */
const MEASURE = `(() => {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (rgb) => { const m = rgb.match(/\\d+(\\.\\d+)?/g).map(Number); return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]); };
  const bgOf = (el) => { let n = el; while (n) { const b = getComputedStyle(n).backgroundColor; if (b && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(b)) return b; n = n.parentElement; } return 'rgb(7,8,14)'; };
  const hidden = (el) => { let n = el; while (n) { if (n.getAttribute && n.getAttribute('aria-hidden') === 'true') return true; n = n.parentElement; } return false; };
  const root = document.querySelector('[data-marketing]');
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const contrast = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent.trim()) continue;
    const el = node.parentElement;
    if (!el || hidden(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const a = lum(cs.color), b = lum(bgOf(el));
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) {
      contrast.push(ratio.toFixed(2) + ':1 ' + size + 'px "' + node.textContent.trim().slice(0, 40) + '"');
    }
  }
  const small = [...root.querySelectorAll('a, button')]
    .map((el) => ({ text: (el.textContent || '').trim().slice(0, 24), height: el.getBoundingClientRect().height }))
    .filter((c) => c.height > 0 && c.height < 36)
    .map((c) => c.text + ' @ ' + c.height.toFixed(1) + 'px');
  return { contrast, small };
})()`;

for (const width of [1440, 390]) {
  test(`the landing holds AA and the 36px floor at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);

    // `evaluate` on a string expression cannot infer a return type, so it is
    // stated here rather than left as `unknown`.
    const { contrast, small } = await page.evaluate<{
      contrast: string[];
      small: string[];
    }>(MEASURE);
    expect(contrast, `text below AA at ${width}px`).toEqual([]);
    expect(small, `controls under the 36px floor at ${width}px`).toEqual([]);
  });
}
