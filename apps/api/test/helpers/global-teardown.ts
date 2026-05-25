// apps/api/test/helpers/global-teardown.ts
// Vitest globalSetup hook for the integration suite.
//
// Why: integration tests spin up real Postgres via Testcontainers. The
// Testcontainers Node SDK ships a Reaper (ryuk) sidecar that is supposed
// to remove labeled containers when the test process disconnects, but in
// WSL2 + Docker Desktop + .withReuse() scenarios the Reaper sometimes
// outlives the test process or never receives the disconnect signal — so
// without an explicit teardown, every aborted/timed-out run leaves a
// 'healthy' postgres:16-alpine orphan behind. Over weeks of CI runs the
// host accumulates dozens of unused containers consuming RAM, ports, and
// disk.
//
// What: a vitest globalSetup is a module that exports a default function.
// Its return value, if a function, is invoked once after every test file
// in the run completes (success OR failure). We use that to docker rm -f
// every container labeled org.testcontainers=true — the canonical label
// Testcontainers stamps on each container it creates. Compose-managed
// containers (fleet-pilot-*) carry com.docker.compose.* labels instead
// and are never matched, so the dev stack is safe.
//
// 2026 best practice: run the cleanup via the local docker CLI (already
// required for testcontainers to work) rather than re-using the
// testcontainers JS client — the client may have been left in a broken
// state by the very failure we're cleaning up after.
import { execFileSync } from 'node:child_process';
export default function setup(): () => Promise<void> {
  // eslint-disable-next-line @typescript-eslint/require-await -- vitest globalSetup teardown must return a Promise<void> even when the body is sync
  return async function teardown(): Promise<void> {
    try {
      const idsRaw = execFileSync(
        'docker',
        ['ps', '-aq', '--filter', 'label=org.testcontainers=true'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      ).toString().trim();
      if (idsRaw.length === 0) return;
      const ids = idsRaw.split(/\s+/);
      execFileSync('docker', ['rm', '-f', ...ids], { stdio: ['ignore', 'pipe', 'pipe'] });
      process.stderr.write('[vitest globalTeardown] removed ' + String(ids.length) + ' testcontainers container(s)\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write('[vitest globalTeardown] docker cleanup failed: ' + msg + '\n');
    }
  };
}
