import { clearRateLimits } from "./support/rate-limits";

/** Keep rate-limit counters clear for the length of an E2E run.
 *
 *  Registration allows five attempts an hour per IP and login ten per fifteen
 *  minutes — the right budget for a real signup form, and the wrong one for a
 *  suite that exercises both on every pass. Clearing once at the start was not
 *  enough: a full run makes more than five registrations, so whichever test
 *  happened to cross the line failed, and which one that was moved with the
 *  ordering. That is what made the suite look randomly flaky.
 *
 *  Sweeping on a timer keeps any window from accumulating more than a minute of
 *  traffic, at three or four `docker exec`s a run rather than one per test.
 */
const SWEEP_MS = 60_000;

export default async function globalSetup(): Promise<() => Promise<void>> {
  await clearRateLimits();
  console.log("[e2e] rate-limit counters cleared, sweeping every 60s");

  const timer = setInterval(() => void clearRateLimits(), SWEEP_MS);
  // Never the reason the process stays alive once the run is over.
  timer.unref();

  return async () => {
    clearInterval(timer);
  };
}
