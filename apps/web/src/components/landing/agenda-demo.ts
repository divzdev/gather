/** The agenda drag-and-drop demo, ported from the landing prototype's script.
 *
 * Kept apart from the other six because it is the only one that measures the
 * page: the card is animated to real coordinates read off the target cells, so
 * the mock stays aligned at any width and through the `scale()` the narrow
 * breakpoint applies to it.
 *
 * It is also the only one a visitor can interrupt. Hovering pauses at the step
 * it reached and shows a play control, because the sequence tells the product's
 * central story (a conflicting drop is accepted, then resolved) and people stop
 * to read it.
 */

const CUE = "cubic-bezier(.22,.8,.24,1)";
const STRIKE = "cubic-bezier(.16,1,.3,1)";
const PERIOD = 8800;

type Step = readonly [number, () => void];

export function agendaDrag(root: HTMLElement): () => void {
  const box = root.querySelector<HTMLElement>("[data-demo]");
  if (box === null) return () => {};

  const drag = box.querySelector<HTMLElement>("[data-drag]");
  const occupied = box.querySelector<HTMLElement>("[data-occ]");
  const chip = box.querySelector<HTMLElement>("[data-dchip]");
  const inspector = box.querySelector<HTMLElement>("[data-insp]");
  const play = box.querySelector<HTMLElement>("[data-dplay]");
  const cellA = box.querySelector<HTMLElement>("[data-cell-a]");
  const cellB = box.querySelector<HTMLElement>("[data-cell-b]");
  if (drag === null || occupied === null || chip === null || inspector === null) {
    return () => {};
  }
  if (cellA === null || cellB === null) return () => {};

  /* The 780px breakpoint scales the whole mock, so getBoundingClientRect returns
     scaled pixels while transforms are applied in unscaled ones. Dividing by the
     ratio converts between them. */
  const ratio = () => box.getBoundingClientRect().width / box.offsetWidth || 1;
  const origin = (element: HTMLElement): [number, number] => {
    const scale = ratio();
    const outer = box.getBoundingClientRect();
    const inner = element.getBoundingClientRect();
    return [(inner.left - outer.left) / scale, (inner.top - outer.top) / scale];
  };
  const shift = (
    from: [number, number],
    target: HTMLElement,
    dx: number,
    dy: number,
  ): string => {
    const [x, y] = origin(target);
    return `translate(${(x - from[0] + dx).toFixed(1)}px,${(y - from[1] + dy).toFixed(1)}px)`;
  };

  let dragHome: [number, number] | null = null;
  let occupiedHome: [number, number] | null = null;

  const setChip = (label: string, kind: "alarm" | "clear") => {
    chip.textContent = label;
    chip.style.borderColor = kind === "alarm" ? "#F0766A" : "#57B899";
    chip.style.color = kind === "alarm" ? "#F0766A" : "#57B899";
    chip.style.background = kind === "alarm" ? "#3A1F1E" : "#123029";
    chip.style.transition = "opacity .18s";
    chip.style.opacity = "1";
  };

  const steps: Step[] = [
    [
      0,
      () => {
        if (dragHome === null) {
          dragHome = origin(drag);
          occupiedHome = origin(occupied);
        }
        drag.style.transition = "none";
        drag.style.transform = "none";
        drag.style.borderColor = "#26262D";
        drag.style.boxShadow = "none";
        occupied.style.transition = "none";
        occupied.style.transform = "none";
        chip.style.transition = "none";
        chip.style.opacity = "0";
        inspector.style.transform = "translateX(118%)";
      },
    ],
    [
      600,
      () => {
        drag.style.transition = `transform .32s ${CUE}, border-color .2s, box-shadow .2s`;
        drag.style.borderColor = "#FF5A36";
        drag.style.boxShadow = "0 22px 40px -14px rgba(0,0,0,.85)";
        drag.style.transform = "translate(6px,-6px) scale(1.02)";
      },
    ],
    [
      1150,
      () => {
        if (dragHome === null) return;
        drag.style.transition = `transform .72s ${CUE}, border-color .2s`;
        drag.style.transform = `${shift(dragHome, cellA, 4, 30)} scale(1.02)`;
      },
    ],
    [1850, () => setChip("Speaker clash: Priya Raghunathan, 10:00", "alarm")],
    [
      2650,
      () => {
        if (dragHome === null) return;
        drag.style.transition = `transform .3s ${STRIKE}`;
        drag.style.transform = shift(dragHome, cellA, 4, 38);
      },
    ],
    [
      3150,
      () => {
        inspector.style.transform = "translateX(0)";
      },
    ],
    [
      4700,
      () => {
        if (dragHome === null || occupiedHome === null) return;
        occupied.style.transition = `transform .5s ${CUE}`;
        occupied.style.transform = shift(occupiedHome, cellB, 0, 0);
        drag.style.transition = `transform .45s ${CUE}, border-color .3s, box-shadow .3s`;
        drag.style.transform = shift(dragHome, cellA, 0, 0);
        drag.style.borderColor = "#26262D";
        drag.style.boxShadow = "none";
      },
    ],
    [5300, () => setChip("Clear", "clear")],
    [
      5950,
      () => {
        inspector.style.transform = "translateX(118%)";
      },
    ],
    [
      6600,
      () => {
        chip.style.transition = "opacity .6s";
        chip.style.opacity = "0";
      },
    ],
  ];

  let timers: ReturnType<typeof setTimeout>[] = [];
  let reached = 0;
  let paused = true;
  let started = false;

  const runFrom = (index: number) => {
    paused = false;
    timers.forEach(clearTimeout);
    timers = [];
    const base = steps[index]?.[0] ?? 0;
    for (let at = index; at < steps.length; at += 1) {
      const step = steps[at];
      if (step === undefined) continue;
      timers.push(
        setTimeout(() => {
          reached = at + 1;
          step[1]();
        }, step[0] - base),
      );
    }
    timers.push(
      setTimeout(() => {
        reached = 0;
        runFrom(0);
      }, PERIOD - base),
    );
  };

  const pause = () => {
    if (paused || !started) return;
    paused = true;
    timers.forEach(clearTimeout);
    timers = [];
    if (play === null) return;
    play.style.opacity = "1";
    play.style.pointerEvents = "auto";
  };
  const resume = () => {
    if (!paused || !started) return;
    if (play !== null) {
      play.style.opacity = "0";
      play.style.pointerEvents = "none";
    }
    runFrom(Math.min(reached, steps.length - 1));
  };
  const onPlay = (event: Event) => {
    event.stopPropagation();
    resume();
  };

  box.addEventListener("mouseenter", pause);
  box.addEventListener("mouseleave", resume);
  play?.addEventListener("click", onPlay);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.disconnect();
        started = true;
        runFrom(0);
      }
    },
    { threshold: 0.35 },
  );
  observer.observe(box);

  return () => {
    observer.disconnect();
    timers.forEach(clearTimeout);
    box.removeEventListener("mouseenter", pause);
    box.removeEventListener("mouseleave", resume);
    play?.removeEventListener("click", onPlay);
  };
}
