import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Drop this run's rate-limit counters.
 *
 *  The budgets are right for real traffic and wrong for a suite that exercises
 *  the same endpoints repeatedly: five public submissions an hour per IP is
 *  correct for a call for papers and exhausted by three fixtures.
 *
 *  Only this run's, though. The pattern used to be `ratelimit:*`, which is the
 *  dev API's namespace and pytest's as well — so a browser run sweeping on a
 *  timer reset a budget an API test was mid-way through asserting, and the
 *  failure landed on whichever test the timer happened to fall on. `make
 *  test.e2e` gives its API `RATE_LIMIT_PREFIX=ratelimit-e2e` and passes the
 *  same value here.
 *
 *  Best effort — if Redis is not reachable this way the run continues and the
 *  affected test reports the rate limit itself.
 */
export async function clearRateLimits(): Promise<void> {
  const container = process.env.E2E_REDIS_CONTAINER ?? "gather-redis";
  const prefix = process.env.E2E_RATE_LIMIT_PREFIX ?? "ratelimit";
  try {
    await run("docker", [
      "exec",
      container,
      "sh",
      "-lc",
      `redis-cli --scan --pattern '${prefix}:*' | xargs -r redis-cli DEL`,
    ]);
  } catch {
    // Deliberately silent: the test that needs it will say so.
  }
}
