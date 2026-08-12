import { defineConfig, devices } from "@playwright/test";

/** E2E against a real API and a real database.
 *
 *  Nothing is mocked. The point of these is to catch what unit tests cannot —
 *  that the two halves agree — so a stubbed API would defeat them entirely.
 *  They assume `make dev` (or api + web) is already running, and skip loudly
 *  rather than failing if it is not.
 */
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  // One retry because the suite shares a single seeded event across all files:
  // three consecutive full runs each failed exactly one test — a different one
  // each time (18, then 04, then 02) — and every one of them passes repeatedly
  // in isolation. That pattern is in-suite state and timing, not broken
  // assertions, and a retry distinguishes the two: a real regression fails
  // twice. The durable fix is per-file event isolation, noted in
  // 04-public-submit.spec.ts.
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"]],
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
