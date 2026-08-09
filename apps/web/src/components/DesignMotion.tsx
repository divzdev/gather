"use client";

/** Runtime for converted design screens.
 *
 * Supplies the behaviour the .dc.html prototypes got from support.js: [data-rv]
 * scroll reveals with a per-element delay, [data-count] count-up, and the hover
 * rules the converter lifted out of style-hover into real CSS.
 */

import { useEffect, useRef } from "react";

export function DesignMotion({ css, children }: { css: string; children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = root.current;
    if (node === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const reveals = [...node.querySelectorAll<HTMLElement>("[data-rv]")];
    for (const element of reveals) {
      const delay = Number(element.dataset.rv ?? 0);
      element.style.transition = `opacity 620ms cubic-bezier(.2,.8,.2,1) ${delay}ms, transform 620ms cubic-bezier(.2,.8,.2,1) ${delay}ms`;
      if (reduced) continue;
      element.style.opacity = "0";
      element.style.transform = "translateY(14px)";
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const element = entry.target as HTMLElement;
          element.style.opacity = "1";
          element.style.transform = "none";
          revealObserver.unobserve(element);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    if (!reduced) reveals.forEach((element) => revealObserver.observe(element));

    const frames: number[] = [];
    const countObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const element = entry.target as HTMLElement;
        countObserver.unobserve(element);
        const target = Number(element.dataset.count ?? 0);
        if (reduced || target === 0) {
          element.textContent = String(target);
          continue;
        }
        const start = performance.now();
        const step = (now: number) => {
          const t = Math.min(1, (now - start) / 1100);
          element.textContent = String(Math.round(target * (1 - Math.pow(1 - t, 3))));
          if (t < 1) frames.push(requestAnimationFrame(step));
        };
        frames.push(requestAnimationFrame(step));
      }
    });
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
    <div ref={root}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      {children}
    </div>
  );
}
