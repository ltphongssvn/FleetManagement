// apps/dispatcher-app/vitest.config.ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [resolve(__dirname, 'src/**/*.ts')],
      // install-fetch-polyfill.ts is excluded for the SAME reason the
      // driver-app config excludes its verbatim twin (that list also
      // carries sentry-bootstrap, the native storage modules and the
      // .web.ts platform variants). The module body is one side-effectful
      // global assignment, globalThis.fetch = expoFetch, executed at import
      // time and targeting the RN 0.83 Bridgeless runtime. Importing it into
      // this node-env lane to cover it would replace global fetch for every
      // other suite in the lane -- a test that damages its own lane to
      // satisfy a number. It is environment-forced boilerplate whose real
      // verification is the on-device run (V13), not a unit assertion.
      exclude: [
        '**/index.ts',
        '**/*.config.ts',
        '**/test/**',
        'src/polyfills/install-fetch-polyfill.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
        perFile: true,
      },
      reportsDirectory: 'coverage/unit',
    },
  },
});
