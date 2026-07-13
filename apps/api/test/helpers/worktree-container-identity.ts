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
import { execFileSync } from 'node:child_process';

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

/** Exec seam for tests: docker CLI runner returning stdout as a string. */
export type DockerExec = (cmd: string, args: readonly string[]) => string;
const defaultExec: DockerExec = (cmd, args) =>
  execFileSync(cmd, [...args], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
/** Start-of-run self-heal (root-cause fix, T17): force-remove containers left
 *  behind by an ABORTED prior run (turbo cascade-cancel, Ctrl-C, killed
 *  globalSetup) so the fixed-name .start() never 409s. Scoping invariant
 *  (2026-07-04 incident): BOTH label filters AND together, so only THIS
 *  worktree''s testcontainers can ever be reaped. Mirror of the label-scoped
 *  removal global-teardown.ts performs at run END. Returns removed count. */
export function removeStaleWorktreeContainers(
  key: string,
  exec: DockerExec = defaultExec,
): number {
  const raw = exec('docker', [
    'ps', '-aq',
    '--filter', 'label=org.testcontainers=true',
    '--filter', 'label=' + WORKTREE_LABEL_KEY + '=' + key,
  ]).trim();
  if (raw.length === 0) return 0;
  const ids = raw.split(/\s+/).filter((id) => id.length > 0);
  if (ids.length === 0) return 0;
  exec('docker', ['rm', '-f', ...ids]);
  return ids.length;
}
