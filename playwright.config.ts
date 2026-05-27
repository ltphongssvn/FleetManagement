// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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
        // In CI: use a pre-built production server. 'next dev' cold-start on
        // GitHub-hosted runners can exceed 4 minutes under contention; 'next
        // start' against a prebuilt .next is sub-30s and matches what
        // dispatchers run in staging/prod. Locally we keep 'next dev' for HMR.
        command: process.env.CI
          ? 'pnpm --filter @fleet/ops-web exec next build && pnpm --filter @fleet/ops-web exec next start -p 3001'
          : 'pnpm --filter @fleet/ops-web dev',
        url: 'http://localhost:3001',
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
