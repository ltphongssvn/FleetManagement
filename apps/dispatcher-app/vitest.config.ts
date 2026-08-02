// apps/dispatcher-app/vitest.config.ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Pool bounding, required by apps/api/test/vitest-maxworkers-ssot.guard
    // .guard.test.ts: vitest sizes its pool from os.availableParallelism(),
    // which reports HOST cores and cannot see the other worktree runners on
    // this box. Every runner concludes it owns all 8 cores; individually
    // correct, collectively ~21 workers. driver-app was exempted as node-env
    // and then moved into MUST_BOUND after a SYNCHRONOUS Intl call died at
    // the 5000ms default under neighbour thrash -- a cheap pool starved is
    // still starved. This package is the same class: an Expo/RN app, not a
    // pure-function package.
    //
    // fileParallelism:false rather than maxWorkers (owner-app precedent, the
    // sanctioned lever for racy specs): with only 6 files, suites touching
    // shared globals batch together and leak. install-fetch-polyfill assigns
    // globalThis.fetch, and copilot-client + session-manager both exercise
    // fetch/token globals. Serializing gives each file a clean global scope.
    // Cheap here: the suite runs in ~1.5s.
    fileParallelism: false,
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
