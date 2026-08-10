/** The landing prototype's scripted product demos.
 *
 * `tools/dc2tsx.py` drops <script>, so the seven looping demos in
 * `GatherDesign/Gather Landing.dc.html` arrive as inert markup. These are that
 * script, ported: same durations, easings, thresholds and colours, driven off
 * the same data-* hooks the converter leaves on the elements.
 *
 * Each demo takes the landing root and returns its own teardown. Every one of
 * them is a no-op when its host element is missing, so a design change that
 * removes a section cannot throw.
 */

const CUE = "cubic-bezier(.22,.8,.24,1)";
const STRIKE = "cubic-bezier(.16,1,.3,1)";

export type Teardown = () => void;
export type Demo = (root: HTMLElement) => Teardown;

/** Runs `start` the first time `host` is properly on screen, then disconnects.
 *  Every demo is idle until seen, so a visitor who never scrolls that far pays
 *  nothing for it. */
function whenSeen(host: Element | null, start: () => void, threshold = 0.3): Teardown {
  if (host === null) return () => {};
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.disconnect();
        start();
      }
    },
    { threshold },
  );
  observer.observe(host);
  return () => observer.disconnect();
}

/** A demo that replays forever: `steps` are [delay, action] from the top of each
 *  cycle, and the whole thing restarts after `period`. */
function loop(
  host: Element | null,
  steps: readonly (readonly [number, () => void])[],
  period: number,
): Teardown {
  let timers: ReturnType<typeof setTimeout>[] = [];
  const run = () => {
    timers.forEach(clearTimeout);
    timers = steps.map(([at, act]) => setTimeout(act, at));
    timers.push(setTimeout(run, period));
  };
  const stop = whenSeen(host, run);
  return () => {
    stop();
    timers.forEach(clearTimeout);
  };
}

const one = (root: HTMLElement, selector: string) =>
  root.querySelector<HTMLElement>(selector);
const all = (root: HTMLElement, selector: string) => [
  ...root.querySelectorAll<HTMLElement>(selector),
];

/** Hand-drawn annotation arrows draw themselves in, stroke by stroke. */
export const arrows: Demo = (root) => {
  const stops = all(root, "[data-arrow]").map((svg) => {
    const paths = [...svg.querySelectorAll<SVGPathElement>("path")];
    for (const path of paths) {
      const length = path.getTotalLength();
      path.style.strokeDasharray = String(length);
      path.style.strokeDashoffset = String(length);
      path.style.transition = `stroke-dashoffset .6s ${CUE}`;
    }
    let timers: ReturnType<typeof setTimeout>[] = [];
    const stop = whenSeen(
      svg,
      () => {
        timers = paths.map((path, index) =>
          setTimeout(() => {
            path.style.strokeDashoffset = "0";
          }, index * 160),
        );
      },
      0.35,
    );
    return () => {
      stop();
      timers.forEach(clearTimeout);
    };
  });
  return () => stops.forEach((stop) => stop());
};

/** Depth on the decorative layers: they drift against the scroll, clamped to
 *  18px so nothing detaches from the content it belongs to. */
export const parallax: Demo = (root) => {
  const layers = all(root, "[data-plx]");
  if (layers.length === 0) return () => {};
  let queued = false;
  const place = () => {
    queued = false;
    const viewport = window.innerHeight;
    for (const layer of layers) {
      const box = layer.getBoundingClientRect();
      if (box.bottom < -100 || box.top > viewport + 100) continue;
      const offset = (box.top + box.height / 2 - viewport / 2) / viewport;
      const shift = Math.max(-18, Math.min(18, -offset * 36));
      layer.style.transform = `translateY(${shift.toFixed(1)}px)`;
    }
  };
  const onScroll = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(place);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  place();
  return () => window.removeEventListener("scroll", onScroll);
};

/** Form builder: a field is dropped in, conditional logic appears, the preview
 *  catches up. */
export const formBuilder: Demo = (root) => {
  const host = one(root, "[data-fb]");
  const drop = host?.querySelector<HTMLElement>("[data-fb-drop]");
  const cond = host?.querySelector<HTMLElement>("[data-fb-cond]");
  const preview = host?.querySelector<HTMLElement>("[data-fb-prev]");
  if (host == null || drop == null || cond == null || preview == null) return () => {};

  return loop(
    host,
    [
      [
        0,
        () => {
          drop.style.transition = "none";
          drop.style.transform = "translate(26px,-22px) rotate(-2deg)";
          drop.style.opacity = ".45";
          drop.style.borderColor = "#FF5A36";
          cond.style.transition = "none";
          cond.style.opacity = "0";
          cond.style.transform = "translateX(-10px)";
          preview.style.transition = "none";
          preview.style.opacity = "0";
        },
      ],
      [
        420,
        () => {
          drop.style.transition = `transform .5s ${CUE}, opacity .4s, border-color .4s`;
          drop.style.transform = "none";
          drop.style.opacity = "1";
        },
      ],
      [
        1000,
        () => {
          drop.style.borderColor = "#26262D";
        },
      ],
      [
        1250,
        () => {
          cond.style.transition = `opacity .4s ease, transform .4s ${CUE}`;
          cond.style.opacity = "1";
          cond.style.transform = "none";
        },
      ],
      [
        1900,
        () => {
          preview.style.transition = "opacity .45s ease";
          preview.style.opacity = "1";
        },
      ],
    ],
    5200,
  );
};

/** Review queue: keyboard-driven scoring, three submissions deep. The keycap
 *  flashes are the point — this screen is meant to be worked without a mouse. */
export const reviewQueue: Demo = (root) => {
  const host = one(root, "[data-rq]");
  if (host === null) return () => {};
  const rows = all(root, "[data-rq-row]");
  const bars = all(root, "[data-rq-bar]");
  const fills = all(root, "[data-rq-fill]");
  const keys = all(root, "[data-rq-key]");
  const title = one(root, "[data-rq-title]");
  const titles = [
    "Serving LLMs on spot GPUs",
    "Evals that catch regressions",
    "The multimodal pipeline at scale",
  ];

  const flash = (index: number) => {
    const key = keys[index];
    if (key === undefined) return;
    key.style.color = "#331313";
    key.style.borderColor = "#FF5A36";
    key.style.background = "#FF5A36";
    setTimeout(() => {
      key.style.color = "#8A8A87";
      key.style.borderColor = "#26262D";
      key.style.background = "transparent";
    }, 320);
  };
  const select = (index: number) => {
    rows.forEach((row, at) => {
      row.style.background = at === index ? "#17171B" : "transparent";
    });
    bars.forEach((bar, at) => {
      bar.style.opacity = at === index ? "1" : "0";
    });
    const next = titles[index];
    if (title !== null && next !== undefined) title.textContent = next;
  };
  const score = (on: boolean) =>
    fills.forEach((fill, at) =>
      setTimeout(() => {
        fill.style.width = on ? `${fill.getAttribute("data-w") ?? 0}%` : "0%";
      }, at * 90),
    );

  for (const row of rows) row.style.transition = "background .18s";
  for (const bar of bars) bar.style.transition = "opacity .18s";
  for (const fill of fills) fill.style.width = "0%";

  return loop(
    host,
    [
      [0, () => (select(0), score(false))],
      [300, () => score(true)],
      [1500, () => flash(2)],
      [1900, () => (flash(3), score(false))],
      [2350, () => (flash(0), select(1))],
      [2900, () => score(true)],
      [4100, () => (flash(0), score(false), select(2))],
      [4700, () => score(true)],
    ],
    6800,
  );
};

/** Send decisions: the recipient count moves under the operator, and the send
 *  stops. The whole product rests on this one refusing to fire. */
export const sendDecisions: Demo = (root) => {
  const host = one(root, "[data-sd]");
  const count = host?.querySelector<HTMLElement>("[data-sd-c]");
  const box = host?.querySelector<HTMLElement>("[data-sd-b]");
  const stop = host?.querySelector<HTMLElement>("[data-sd-stop]");
  const send = host?.querySelector<HTMLElement>("[data-sd-send]");
  if (host == null || count == null || box == null || stop == null) return () => {};

  count.textContent = "38";
  count.style.color = "#F2F2F0";
  box.style.borderColor = "#26262D";
  box.style.background = "#17171B";
  stop.style.opacity = "0";

  let timers: ReturnType<typeof setTimeout>[] = [];
  const cancel = whenSeen(
    host,
    () => {
      timers = [
        setTimeout(() => {
          count.textContent = "41";
          count.style.color = "#F0766A";
          box.style.borderColor = "#F0766A";
          box.style.background = "#3A1F1E";
        }, 1100),
        setTimeout(() => {
          stop.style.opacity = "1";
          if (send !== null && send !== undefined) send.style.opacity = ".45";
        }, 1600),
      ];
    },
    0.4,
  );
  return () => {
    cancel();
    timers.forEach(clearTimeout);
  };
};

/** Speaker portal: a task completes and the outstanding count drops. */
export const portalTask: Demo = (root) => {
  const host = one(root, "[data-pt]");
  const row = host?.querySelector<HTMLElement>("[data-pt-row]");
  const bar = host?.querySelector<HTMLElement>("[data-pt-bar]");
  const tag = host?.querySelector<HTMLElement>("[data-pt-tag]");
  const count = one(root, "[data-pt-count]");
  if (host == null || row == null || bar == null) return () => {};

  bar.style.width = "0";
  let timers: ReturnType<typeof setTimeout>[] = [];
  const cancel = whenSeen(
    host,
    () => {
      timers = [
        setTimeout(() => {
          bar.style.width = "100%";
        }, 500),
        setTimeout(() => {
          row.style.borderLeftColor = "#57B899";
          row.style.opacity = ".7";
          if (tag !== null && tag !== undefined) {
            tag.textContent = "DONE";
            tag.style.color = "#57B899";
            tag.style.background = "#123029";
          }
          bar.style.background = "#57B899";
          if (count === null) return;
          count.textContent = "32";
          count.animate(
            [
              { transform: "translateY(6px)", opacity: 0 },
              { transform: "none", opacity: 1 },
            ],
            { duration: 320, easing: STRIKE },
          );
        }, 1500),
      ];
    },
    0.4,
  );
  return () => {
    cancel();
    timers.forEach(clearTimeout);
  };
};

/** The embed snippet types itself out and the widget resolves beside it. */
export const embedSnippet: Demo = (root) => {
  const host = one(root, "[data-em]");
  const code = host?.querySelector<HTMLElement>("[data-em-code]");
  const out = host?.querySelector<HTMLElement>("[data-em-out]");
  if (host == null || code == null || out == null) return () => {};

  // Split so the string never reads as a closing tag to anything parsing this file.
  const tag = `scr${"ipt"}`;
  const snippet = `<${tag} src="https://gather.dev/embed.js"\n  data-event="devflow-2027"\n  data-view="agenda"></${tag}>`;
  code.textContent = "";
  out.style.opacity = "0";
  out.style.transform = "translateY(10px)";

  const timers: ReturnType<typeof setTimeout>[] = [];
  const cancel = whenSeen(
    host,
    () => {
      timers.push(
        setTimeout(() => {
          out.style.opacity = "1";
          out.style.transform = "none";
        }, 120),
      );
      let typed = 0;
      const tick = () => {
        typed += 1;
        code.textContent = snippet.slice(0, typed);
        if (typed < snippet.length) timers.push(setTimeout(tick, 13));
      };
      timers.push(setTimeout(tick, 240));
    },
    0.25,
  );
  return () => {
    cancel();
    timers.forEach(clearTimeout);
  };
};

/** Command palette: "agenda" is typed, the list filters, one row is chosen. */
export const commandPalette: Demo = (root) => {
  const host = one(root, "[data-pal]");
  if (host === null) return () => {};
  const text = host.querySelector<HTMLElement>("[data-pal-text]");
  const ghost = host.querySelector<HTMLElement>("[data-pal-ghost]");
  const panel = host.querySelector<HTMLElement>("[data-pal-panel]");
  const rows = [...host.querySelectorAll<HTMLElement>("[data-pal-row]")];
  if (text === null || ghost === null || panel === null) return () => {};

  let timers: ReturnType<typeof setTimeout>[] = [];
  const at = (delay: number, act: () => void) => timers.push(setTimeout(act, delay));
  const word = "agenda";

  const cycle = () => {
    timers = [];
    panel.style.transition = "none";
    panel.style.opacity = "1";
    panel.style.transform = "none";
    text.textContent = "";
    ghost.style.opacity = "1";
    for (const row of rows) {
      row.style.transition = "none";
      row.style.transitionDelay = "0ms";
      row.style.opacity = "1";
      row.style.transform = "none";
      row.style.background = "transparent";
      const cue = row.querySelector<HTMLElement>("[data-cuebar]");
      if (cue !== null) {
        cue.style.transition = "none";
        cue.style.opacity = "0";
      }
    }
    for (let index = 0; index < word.length; index += 1) {
      at(500 + index * 130, () => {
        ghost.style.opacity = "0";
        text.textContent = word.slice(0, index + 1);
      });
    }
    at(1750, () => {
      rows.forEach((row, index) => {
        if (row.getAttribute("data-m") !== "0") return;
        row.style.transition = "opacity .24s ease, transform .24s ease";
        row.style.transitionDelay = `${index * 40}ms`;
        row.style.opacity = ".14";
        row.style.transform = "translateX(-4px)";
      });
    });
    at(2550, () => {
      const chosen = rows.find((row) => row.getAttribute("data-m") === "1");
      if (chosen === undefined) return;
      chosen.style.transition = "background .16s";
      chosen.style.background = "#1F1F24";
      const cue = chosen.querySelector<HTMLElement>("[data-cuebar]");
      if (cue === null) return;
      cue.style.transition = "opacity .16s";
      cue.style.opacity = "1";
    });
    at(3400, () => {
      panel.style.transition = "opacity .32s ease, transform .32s ease";
      panel.style.opacity = "0";
      panel.style.transform = "scale(.985) translateY(4px)";
    });
    at(6600, cycle);
  };

  const cancel = whenSeen(host, cycle, 0.4);
  return () => {
    cancel();
    timers.forEach(clearTimeout);
  };
};

/** Reduced-motion resting state for the palette: the finished frame, no typing. */
export function settlePalette(root: HTMLElement): void {
  const text = one(root, "[data-pal-text]");
  const ghost = one(root, "[data-pal-ghost]");
  if (text !== null) text.textContent = "agenda";
  if (ghost !== null) ghost.style.display = "none";
  for (const row of all(root, "[data-pal-row]")) {
    if (row.getAttribute("data-m") === "0") row.style.opacity = ".14";
  }
}
