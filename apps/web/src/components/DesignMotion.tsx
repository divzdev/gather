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
      element.style.opacity = "0";
      element.style.transform = "translateY(26px)";
      element.style.transition = `opacity .75s ${EASE}, transform .75s ${EASE}`;
      element.style.transitionDelay = `${Number(element.dataset.rv ?? 0) || 0}ms`;
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          element.style.opacity = "1";
          element.style.transform = "translateY(0)";
          revealObserver.unobserve(element);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    if (!reduced) reveals.forEach((element) => revealObserver.observe(element));

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
