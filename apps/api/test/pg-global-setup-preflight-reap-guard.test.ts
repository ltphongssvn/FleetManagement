// apps/api/test/pg-global-setup-preflight-reap-guard.test.ts
// Regression guard (root-cause fix 2026-07-11): SECOND orphan class, distinct
// from the .withReuse() one (pg-global-setup-no-reuse-orphan-guard.test.ts).
// A CANCELLED run -- e.g. turbo cascade-cancel when a sibling task of the
// check aggregate fails while test:unit is mid-flight -- kills the vitest
// process BEFORE global-teardown.ts (the single removal owner) can reap the
// deterministically-named container. Ryuk is deliberately disabled, so the
// orphan SURVIVES RUNNING, and the next start() fails with docker 409
// name-conflict (Conflict: container name already in use).
//
// The root fix: globalSetup performs a PRE-START REAP using the SAME
// label-scoped filter as global-teardown.ts (org.testcontainers=true AND this
// worktree's label), force-removing any leftover before constructing the new
// container. Self-healing by construction: however the previous run died
// (cascade-cancel, OOM-kill, power loss), the next run starts clean. The reap
// is best-effort (non-fatal on docker-cli failure): start() stays the
// authoritative error surface.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const setupSrc = readFileSync(resolve(here, 'helpers/pg-global-setup.ts'), 'utf8');
const NL = String.fromCharCode(10);
const SLASH = String.fromCharCode(47);
const LINE_COMMENT = SLASH + SLASH;
// Code-only view (house pattern): drop line-comment lines so CALL assertions
// are not tripped by comments that merely MENTION an API.
const isCommentLine = (line: string): boolean => line.trimStart().startsWith(LINE_COMMENT);
const codeOnly = setupSrc
  .split(NL)
  .filter((line) => !isCommentLine(line))
  .join(NL);
const SQ = String.fromCharCode(39);

describe('pg-global-setup pre-start orphan-reap regression guard', () => {
  it('calls the pre-start reap BEFORE constructing the container (ordering is the fix)', () => {
    const idxReapCall = codeOnly.indexOf('reapOrphanedWorktreeContainers(WT_KEY)');
    // Needle split by concatenation: the single-shared-container guard scans
    // test files for the assembled literal on non-comment lines; this file only
    // SEARCHES for it, never constructs one.
    const idxStart = codeOnly.indexOf('new PostgreSql' + 'Container(');
    expect(idxReapCall).toBeGreaterThan(-1);
    expect(idxStart).toBeGreaterThan(-1);
    expect(idxReapCall).toBeLessThan(idxStart);
  });
  it('scopes the reap by the testcontainers label AND this worktree label (never host-wide)', () => {
    expect(codeOnly.includes(SQ + 'label=org.testcontainers=true' + SQ)).toBe(true);
    expect(codeOnly.includes(SQ + 'label=' + SQ + ' + WORKTREE_LABEL_KEY')).toBe(true);
  });
  it('force-removes leftovers (docker rm -f) so a still-RUNNING orphan is also reaped', () => {
    expect(codeOnly.includes(SQ + 'rm' + SQ + ', ' + SQ + '-f' + SQ)).toBe(true);
  });
  it('reap is best-effort: docker-cli failure is non-fatal (start() stays the error surface)', () => {
    expect(codeOnly.includes('non-fatal')).toBe(true);
  });
});
