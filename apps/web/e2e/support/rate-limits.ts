import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Drop the API's rate-limit counters.
 *
 *  The budgets are right for real traffic and wrong for a suite that exercises
 *  the same endpoints repeatedly: five public submissions an hour per IP is
 *  correct for a call for papers and exhausted by three fixtures. The API's own
 *  pytest suite clears the same keys between tests; this is that, for the
 *  browser.
 *
 *  Best effort — if Redis is not reachable this way the run continues and the
 *  affected test reports the rate limit itself.
 */
export async function clearRateLimits(): Promise<void> {
  const container = process.env.E2E_REDIS_CONTAINER ?? "gather-redis";
  try {
    await run("docker", [
      "exec",
      container,
      "sh",
      "-lc",
      "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli DEL",
    ]);
  } catch {
    // Deliberately silent: the test that needs it will say so.
  }
}
