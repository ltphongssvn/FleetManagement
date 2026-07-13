// apps/api/test/helpers/worktree-container-identity.ts
// Per-worktree identity for the shared Postgres testcontainer. ROOT-CAUSE FIX
// (2026-07-04 gate): testcontainers reuse matches by NAME + config hash, so
// parallel git worktrees with identical setups attached to ONE container; and
// global-teardown removed EVERY org.testcontainers-labelled container
// HOST-WIDE, so whichever worktree''s gate finished first rm -f''d the other
// worktree''s live database mid-run (25 suites passed, then 9 ECONNREFUSED).
// Per 2026 testcontainers guidance, unwanted sharing is prevented by a
// DISTINCT per-environment name/label: each suite uses a different value so
// resources are never accidentally shared. Here that environment is the git
// worktree: the key is a stable hash of the worktree root path, the container
// name embeds it, and teardown filters on the label so it can only ever
// remove its own worktree''s containers. Isolation by construction; warm
// .withReuse() start preserved per worktree.
import { createHash } from 'node:crypto';

/** Docker label key scoping every test container to its owning worktree. */
export const WORKTREE_LABEL_KEY = 'fleet.test.worktree';

/** Stable 12-hex key for a worktree root path (trailing slashes ignored). */
export function worktreeKey(rootPath: string): string {
  const normalized = rootPath.replace(/\/+$/, '');
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

/** Deterministic, docker-safe container name for this worktree''s Postgres. */
export function pgContainerName(key: string): string {
  return 'fleet-pg-test-' + key;
}

// Pre-start reap (root-cause fix, 2026-07-12): Ryuk is deliberately disabled
// (see pg-global-setup), so a run that dies BEFORE global-teardown -- turbo
// cascade-cancel, Ctrl-C, OOM-kill, power loss -- strands a RUNNING container
// under this worktree's deterministic name. The next start() then fails with
// docker 409 (container name already in use). 2026 practice with Ryuk off is a
// label-scoped prune BEFORE construction, so however the previous run died the
// next starts clean (self-healing by construction). Scoped by BOTH the
// testcontainers label AND this worktree's label, exactly like teardown, so a
// parallel worktree's live container can never be reaped. Best-effort: any
// docker-cli failure is swallowed and .start() remains the authoritative error
// surface (never mask a real Docker problem as a reap failure).
import { execFileSync } from 'node:child_process';

export function reapOrphanedWorktreeContainers(key: string): void {
  try {
    const ids = execFileSync(
      'docker',
      [
        'ps', '-aq',
        '--filter', 'label=org.testcontainers=true',
        '--filter', 'label=' + WORKTREE_LABEL_KEY + '=' + key,
      ],
      { encoding: 'utf8' },
    )
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (ids.length === 0) return;
    execFileSync('docker', ['rm', '-f', ...ids], { stdio: 'ignore' });
  } catch {
    // Best-effort: docker missing / cli error -> let .start() surface the truth.
  }
}
