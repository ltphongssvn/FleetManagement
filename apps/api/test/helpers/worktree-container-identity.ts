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
