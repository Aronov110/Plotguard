import { defineConfig, devices } from "@playwright/test";
import { API_ORIGIN, WEB_ORIGIN } from "./e2e/support/targets.ts";

/**
 * End-to-end tests: a real browser against the built web app and a real API on a throwaway
 * database. Both servers get their own ports and are never reused, so a development server that is
 * already running (ports 3000 and 5173) is left alone and can never receive test data.
 *
 * `127.0.0.1`, not `localhost`: the API's origin allowlist and the cookies are tied to that host.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  // A test that passes only on a second try is a flaky test; it must fail loudly instead.
  retries: 0,
  forbidOnly: true,
  // One test at a time: the end-to-end API has a single "hold the next logout reply" switch, and
  // two tests using it at once would take each other's reply. Every test uses its own account, so
  // the order does not matter; the whole run is still only a few minutes.
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: WEB_ORIGIN,
    // Traces can contain typed passwords and cookies. They stay in the gitignored test-results/.
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      command: "node src/test-support/e2e-server.ts",
      cwd: "../api",
      url: `${API_ORIGIN}/health`,
      reuseExistingServer: false,
      // Includes dropping, recreating and migrating the throwaway database.
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "bun run e2e:serve",
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      // NODE_ENV=development makes the bundle read the development cookie name (`csrf_token`),
      // which is what the end-to-end API sets over plain http. A production bundle reads only the
      // `__Host-` name, which needs https and a production API, so it would never find the cookie.
      env: { API_URL: API_ORIGIN, NODE_ENV: "development" },
    },
  ],
});
