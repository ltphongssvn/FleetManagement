// playwright.config.ts
//
// 2026-Q2 invariant: e2e specs run with workers=1 locally too.
// Several specs touch shared global state in the running Docker stack
// (transport_order table, vehicle/driver master data, order_sequence
// counter). Cross-spec parallel contention surfaced as flaky failures
// (vehicle-count drift, leaked seeded labels, slow afterEach DB
// cleanup). Each spec's afterEach/afterAll cleans up its own rows, so
// serial execution is both correct and fast (~1.5 minutes for the full
// suite) — the trade-off vs. ~30s parallel time is well worth the
// determinism. Tests within one spec still parallelize via
// fullyParallel=true, but cross-spec races are eliminated.
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // CI: 2 retries. Local: 1 retry (was 0). The full-suite local run contends for
  // CPU/network when the ~5min --no-cache docker-build spec overlaps seed-heavy
  // specs, causing transient ECONNRESET / ERR_CONNECTION_REFUSED on api.post /
  // page.goto (resource-affected flakiness). One retry re-runs the test in a
  // fresh worker+browser, absorbing the transient drop; kept low (1) so genuine
  // flakiness still surfaces (Playwright tags retried passes as "flaky"). 2026
  // best practice: retries for transient network errors, low count, don't mask.
  retries: process.env.CI ? 2 : 1,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: process.env.CI
          ? 'pnpm --filter @fleet/ops-web exec next build && pnpm --filter @fleet/ops-web exec next start -p 3001'
          : 'pnpm --filter @fleet/ops-web dev',
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
