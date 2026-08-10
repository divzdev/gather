"use client";

/** Runtime for converted design screens.
 *
 * Supplies the behaviour the .dc.html prototypes got from their own script:
 * [data-rv] scroll reveals, [data-count] count-up, and the hover rules the
 * converter lifted out of style-hover into real CSS. The durations, easings and
 * observer thresholds below are the prototype's, not new ones.
 */

import { useEffect, useRef } from "react";

const EASE = "cubic-bezier(.2,.7,.2,1)";

export function DesignMotion({ css, children }: { css: string; children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = root.current;
    if (node === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const reveals = [...node.querySelectorAll<HTMLElement>("[data-rv]")];
    for (const element of reveals) {
      if (reduced) continue;
      // Opacity only. Offsetting stacked text while its in-flow siblings stay
      // put makes the two overlap for the length of the stagger, which is the
      // defect GatherDesign/CLAUDE.md records being reported twice. data-rv is
      // an order index, not a delay: the prototype spaces them 70ms apart.
      element.style.opacity = "0";
      element.style.transition = `opacity .52s ${EASE}`;
      element.style.transitionDelay = `${(Number(element.dataset.rv ?? 0) || 0) * 70}ms`;
    }

    // A hairline that draws itself left to right under a section heading.
    const rules = [...node.querySelectorAll<HTMLElement>("[data-rule]")];
    for (const element of rules) {
      if (reduced) continue;
      element.style.transform = "scaleX(0)";
      element.style.transformOrigin = "left";
      element.style.transition = "transform .7s cubic-bezier(.22,.8,.24,1)";
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          if (element.hasAttribute("data-rule")) element.style.transform = "scaleX(1)";
          else element.style.opacity = "1";
          revealObserver.unobserve(element);
        }
      },
      { threshold: 0.2 },
    );
    if (!reduced) {
      [...reveals, ...rules].forEach((element) => revealObserver.observe(element));
    }

    // Anything already on screen at mount never crosses the threshold, so it
    // would sit at opacity 0 forever. Catch those up once the page has settled.
    const settle = setTimeout(() => {
      for (const element of reveals) {
        const box = element.getBoundingClientRect();
        if (box.top < window.innerHeight && box.bottom > 0) element.style.opacity = "1";
      }
    }, 400);

    const frames: number[] = [];
    const countObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          countObserver.unobserve(element);
          const target = Number(element.dataset.count ?? 0) || 0;
          if (reduced) {
            element.textContent = String(target);
            continue;
          }
          const start = performance.now();
          const tick = (now: number) => {
            const progress = Math.min(1, (now - start) / 1100);
            element.textContent = String(Math.round(target * (1 - Math.pow(1 - progress, 3))));
            if (progress < 1) frames.push(requestAnimationFrame(tick));
          };
          frames.push(requestAnimationFrame(tick));
        }
      },
      { threshold: 0.5 },
    );
    node.querySelectorAll<HTMLElement>("[data-count]").forEach((element) => {
      countObserver.observe(element);
    });

    return () => {
      revealObserver.disconnect();
      countObserver.disconnect();
      clearTimeout(settle);
      frames.forEach(cancelAnimationFrame);
    };
  }, []);

  return (
    // `display: contents` keeps this wrapper out of layout entirely, so a
    // converted screen sits in its parent grid exactly as the prototype did.
    <div ref={root} style={{ display: "contents" }}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {children}
    </div>
  );
}
