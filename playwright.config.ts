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

// e2e OIDC config. The login spec (ops-web-login.spec.ts) drives the
// Authorization Code + PKCE "Đăng nhập" button, which needs these to build the
// authorize request inside the spawned ops-web server, and reads
// OIDC_AUTHORIZATION_ENDPOINT in the test process to intercept/abort the
// navigation to the IdP. CI does not (and must not) talk to the real Keycloak in
// e2e -- the spec ABORTS the navigation to the authorize endpoint -- so these are
// deterministic, stable placeholders, not secrets. We resolve from the ambient
// env when present (so a real value can be supplied locally) and otherwise fall
// back to a fixed example origin. The SAME resolved values are injected into the
// webServer process via `env` below, so the spawned ops-web and the test process
// agree on the authorize endpoint the route interception matches.
const OIDC_E2E_ENV = {
  OIDC_AUTHORIZATION_ENDPOINT:
    process.env['OIDC_AUTHORIZATION_ENDPOINT'] ??
    'https://kc.e2e.example/realms/fleet/protocol/openid-connect/auth',
  OIDC_TOKEN_ENDPOINT:
    process.env['OIDC_TOKEN_ENDPOINT'] ??
    'https://kc.e2e.example/realms/fleet/protocol/openid-connect/token',
  OIDC_CLIENT_ID: process.env['OIDC_CLIENT_ID'] ?? 'ops-web',
  OIDC_REDIRECT_URI:
    process.env['OIDC_REDIRECT_URI'] ?? 'http://localhost:3001/api/auth/callback',
  OIDC_DISPATCH_ACR_VALUES: process.env['OIDC_DISPATCH_ACR_VALUES'] ?? 'aal3',
} as const;
// Ensure the test process itself can read OIDC_AUTHORIZATION_ENDPOINT (the spec
// reads process.env directly to register the abort route).
for (const [k, v] of Object.entries(OIDC_E2E_ENV)) {
  if (process.env[k] === undefined) process.env[k] = v;
}
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
        // Pass the OIDC config to the spawned ops-web so startLogin can build the
        // authorize request; env vars do NOT auto-propagate to the webServer
        // process, they must be passed explicitly (2026 Playwright guidance).
        //
        // NODE_ENV=test (not production) for the spawned server: we run the
        // production BUILD (next build && next start) for fidelity, but the e2e
        // server is served over HTTP on localhost. startLogin marks the transient
        // PKCE cookies `secure` when NODE_ENV==='production', and browsers
        // (Chromium/WebKit) SILENTLY DROP Secure cookies on http://localhost --
        // so the cookies the spec asserts on never get stored and the test fails
        // only in CI. Running the server as NODE_ENV=test sets secure=false, so
        // the cookies persist over HTTP. Production deploys still run with real
        // NODE_ENV=production (Secure cookies) -- this override is e2e-only.
        env: { ...OIDC_E2E_ENV, NODE_ENV: 'test' },
      },
});
