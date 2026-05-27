// apps/api/test/helpers/global-teardown.ts
// Vitest globalSetup hook for the integration suite.
//
// Removes Testcontainers-labeled containers after every run so aborted
// runs don't leave postgres orphans accumulating on the host.
//
// 2026 robustness: under WSL2 + Docker Desktop the docker socket can
// briefly fail with 'accept4 failed' VSock errors during the cleanup
// window. Retry the `docker ps` probe up to 3 times with short backoff
// before giving up. The retry catches transient socket flaps without
// masking real docker outages.
import { execFileSync } from 'node:child_process';
function sleepSyncMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) { /* busy wait — sync because we're in vitest teardown */ }
}
function listTestcontainerIds(maxAttempts: number): readonly string[] {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = execFileSync(
        'docker',
        ['ps', '-aq', '--filter', 'label=org.testcontainers=true'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      ).toString().trim();
      return raw.length === 0 ? [] : raw.split(/\s+/);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) sleepSyncMs(500 * attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('docker ps failed');
}
export default function setup(): () => Promise<void> {
  // eslint-disable-next-line @typescript-eslint/require-await -- vitest globalSetup teardown must return a Promise<void> even when the body is sync
  return async function teardown(): Promise<void> {
    try {
      const ids = listTestcontainerIds(3);
      if (ids.length === 0) return;
      execFileSync('docker', ['rm', '-f', ...ids], { stdio: ['ignore', 'pipe', 'pipe'] });
      process.stderr.write('[vitest globalTeardown] removed ' + String(ids.length) + ' testcontainers container(s)\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write('[vitest globalTeardown] docker cleanup failed (non-fatal): ' + msg + '\n');
    }
  };
}
