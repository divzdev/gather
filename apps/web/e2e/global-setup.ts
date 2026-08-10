import { clearRateLimits } from "./support/rate-limits";

/** Clear rate-limit counters before an E2E run.
 *
 *  Registration allows five attempts an hour per IP, which is the right budget
 *  for a real signup form and the wrong one for a suite that exercises it on
 *  every pass.
 */
export default async function globalSetup(): Promise<void> {
  await clearRateLimits();
  console.log("[e2e] rate-limit counters cleared");
}
