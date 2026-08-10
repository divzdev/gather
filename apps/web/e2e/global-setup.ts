import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Clear rate-limit counters before an E2E run.
 *
 *  Registration allows five attempts an hour per IP, which is the right budget
 *  for a real signup form and the wrong one for a suite that exercises it on
 *  every pass. The API's own pytest suite clears the same keys between tests;
 *  this is that, for the browser.
 *
 *  Best effort on purpose: if Redis is not reachable this way, the run should
 *  still happen and the rate-limited test will say so itself.
 */
export default async function globalSetup(): Promise<void> {
  const container = process.env.E2E_REDIS_CONTAINER ?? "gather-redis";
  try {
    const { stdout } = await run("docker", [
      "exec",
      container,
      "sh",
      "-lc",
      "redis-cli --scan --pattern 'ratelimit:*' | xargs -r redis-cli DEL",
    ]);
    const cleared = stdout.trim();
    console.log(`[e2e] rate-limit counters cleared${cleared ? ` (${cleared})` : ""}`);
  } catch {
    console.log("[e2e] could not clear rate-limit counters; continuing");
  }
}
