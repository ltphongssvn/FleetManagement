// apps/api/test/helpers/global-teardown.ts
// Vitest globalSetup hook for the integration suite.
//
// Removes THIS WORKTREE''S Testcontainers-labeled containers after every run so
// aborted runs don''t leave postgres orphans accumulating on the host.
//
// SCOPED CLEANUP (root-cause fix, 2026-07-04): the filter is
// org.testcontainers=true AND fleet.test.worktree=<this worktree''s key>.
// The old label-only filter removed EVERY testcontainers container HOST-WIDE,
// so a gate finishing in one worktree rm -f''d the reused Postgres out from
// under a gate still running in another worktree (ECONNREFUSED mid-run).
// Multiple docker --filter flags AND together, so this teardown can only ever
// reap containers created by THIS worktree''s pg-global-setup.
//
// 2026 robustness: under WSL2 + Docker Desktop the docker socket can briefly
// fail with 'accept4 failed' VSock errors during the cleanup window. Retry the
// `docker ps` probe up to 3 times with short backoff before giving up. The
// retry catches transient socket flaps without masking real docker outages.
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { worktreeKey, WORKTREE_LABEL_KEY } from './worktree-container-identity.js';

const here = dirname(fileURLToPath(import.meta.url));
const WT_KEY = worktreeKey(resolve(here, '../../../..'));

function sleepSyncMs(ms: number): void {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* busy wait — sync because we're in vitest teardown */
  }
}
function listTestcontainerIds(maxAttempts: number): readonly string[] {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const raw = execFileSync(
        'docker',
        [
          'ps',
          '-aq',
          '--filter',
          'label=org.testcontainers=true',
          '--filter',
          'label=' + WORKTREE_LABEL_KEY + '=' + WT_KEY,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
        .toString()
        .trim();
      return raw.length === 0 ? [] : raw.split(/\s+/);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) sleepSyncMs(Math.min(3200, 500 * Math.pow(2, attempt - 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('docker ps failed');
}
export default function setup(): () => Promise<void> {
  // eslint-disable-next-line @typescript-eslint/require-await -- vitest globalSetup teardown must return a Promise<void> even when the body is sync
  return async function teardown(): Promise<void> {
    try {
      const ids = listTestcontainerIds(6);
      if (ids.length === 0) return;
      execFileSync('docker', ['rm', '-f', ...ids], { stdio: ['ignore', 'pipe', 'pipe'] });
      process.stderr.write(
        '[vitest globalTeardown] removed ' +
          String(ids.length) +
          ' testcontainers container(s) for worktree ' +
          WT_KEY +
          '\n',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        '[vitest globalTeardown] docker cleanup failed (non-fatal): ' + msg + '\n',
      );
    }
  };
}
