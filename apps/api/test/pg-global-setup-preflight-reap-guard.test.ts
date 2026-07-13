// apps/api/test/pg-global-setup-preflight-reap-guard.test.ts
// Regression guard (root-cause fix 2026-07-12): with Ryuk deliberately
// disabled, a run that dies before global-teardown (turbo cascade-cancel,
// Ctrl-C, OOM-kill) strands this worktree RUNNING container under its
// deterministic name, and the next start() fails with docker 409
// (container name already in use). The fix: globalSetup calls
// reapOrphanedWorktreeContainers(WT_KEY) AFTER disabling Ryuk and BEFORE
// constructing the container, label-scoped exactly like global-teardown so a
// parallel worktree live container is never reaped. This guard pins that
// ordering + the label scope + rm -f + best-effort behavior so the
// self-healing property cannot be silently removed.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const setupSrc = readFileSync(resolve(here, 'helpers/pg-global-setup.ts'), 'utf8');
const identitySrc = readFileSync(resolve(here, 'helpers/worktree-container-identity.ts'), 'utf8');
const NL = String.fromCharCode(10);
const SLASH = String.fromCharCode(47);
const LINE_COMMENT = SLASH + SLASH;
// Code-only view: drop line-comment lines so CALL/ordering assertions are not
// tripped by comments that merely mention an API.
function codeOnly(src: string): string {
  return src
    .split(NL)
    .filter((ln) => !ln.trim().startsWith(LINE_COMMENT))
    .join(NL);
}
const setupCode = codeOnly(setupSrc);
const identityCode = codeOnly(identitySrc);
const WORKTREE_LABEL_NEEDLE = 'WORKTREE_LABEL_KEY';
const RM_NEEDLE = '-f';
describe('pg-global-setup pre-start reap guard', () => {
  it('the shared identity module exports a label-scoped force-reap', () => {
    expect(identityCode).toContain('export function reapOrphanedWorktreeContainers');
    expect(identityCode).toContain('label=org.testcontainers=true');
    expect(identityCode).toContain(WORKTREE_LABEL_NEEDLE);
    expect(identityCode).toContain(RM_NEEDLE);
  });
  it('the reaper is best-effort (swallows docker-cli failure)', () => {
    expect(identityCode).toContain('try {');
    expect(identityCode).toContain('} catch');
  });
  it('globalSetup reaps AFTER disabling Ryuk and BEFORE constructing the container', () => {
    const ryukAt = setupCode.indexOf('TESTCONTAINERS_RYUK_DISABLED');
    const reapAt = setupCode.indexOf('reapOrphanedWorktreeContainers(');
    const constructAt = setupCode.indexOf('new PostgreSqlContainer');
    expect(ryukAt).toBeGreaterThan(-1);
    expect(reapAt).toBeGreaterThan(-1);
    expect(constructAt).toBeGreaterThan(-1);
    expect(ryukAt).toBeLessThan(reapAt);
    expect(reapAt).toBeLessThan(constructAt);
  });
});
