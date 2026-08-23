// apps/api/test/vitest-maxworkers-ssot.guard.test.ts
// Regression guard (root-cause fix 2026-07-17): every vitest config that can
// spawn a worker pool must BOUND that pool explicitly.
//
// Root cause, and it is not a budget: vitest sizes its pool from
// os.availableParallelism(), which reports the HOST core count. It cannot see
// the other vitest processes on the box. This machine runs up to ~8 parallel
// worktree terminals, so every runner independently concludes it owns all 8
// cores. Each is individually correct and collectively wrong: 3 concurrent
// worktrees x ~7 workers = ~21 workers on 8 cores. Observed live: t4-wt6
// running ops-web coverage with 8 forks while t23-wt2 ran api integration and
// a third worktree held the pre-push gate.
//
// 9710dd8 fixed the SCHEDULING half with a machine-global flock, and its
// diagnosis stands: the root cause is scheduling, not budgets. But the flock
// guards ONE entry point -- the pre-push gate. A directly invoked
// turbo run test:integration or vitest run --coverage never touches it, so
// thrash still arrives through the side doors. Bounding each pool is what
// closes them.
//
// packages/codemods/vitest.config.ts already documents this exact failure mode
// (Vitest-4-on-Turborepo CPU oversubscription) and caps itself. apps/api caps
// itself three times over. The cap was applied to the packages that hurt and
// never made an invariant -- so apps/ops-web still ships testTimeout with no
// cap and spawns 8 forks. Same drift shape f9921a1 closed for hookTimeout:
// the durable fix is not another manual pass, it is the thing that makes the
// next one unnecessary.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const NL = String.fromCharCode(10);
const SLASH = String.fromCharCode(47);
const LINE_COMMENT = SLASH + SLASH;

// Code-only view (pg-global-setup-no-reuse-orphan-guard.test.ts precedent, via
// hook-timeout-ssot.guard.test.ts): drop line-comment lines so an assertion
// about CODE is never satisfied by prose that merely mentions the pattern --
// including this file's own header.
const isCommentLine = (line: string): boolean => line.trimStart().startsWith(LINE_COMMENT);
const codeOnly = (src: string): string =>
  src
    .split(NL)
    .filter((line) => !isCommentLine(line))
    .join(NL);

// Configs that run a pool and therefore must bound it. Node-environment
// configs for pure-function packages (domain, observability, sync-protocol,
// test-fixtures, main-worker) are cheap and unbounded by design; they are
// listed as EXEMPT rather than omitted so the exemption is on the record.
//
// driver-app was initially placed in that exempt set as a node-env package,
// but it is NEITHER pure-function NOR cheap: 643 tests across 60 files
// exercise web/native dual-environment code (token-storage localStorage
// round-trips, Intl locale formatting), and with NO cap it opens host-core
// forks like any other pool. Cheapness lowers per-worker cost; it does not
// stop fork oversubscription. Observed 2026-07-17: token-storage and
// vn-locale-date-us -- a SYNCHRONOUS Intl call -- died at the 5000ms default
// under ~21-worker neighbour thrash while passing 9/9 in 1.66s isolated. A
// cheap pool starved is still starved, so it must bound like the rest.
const MUST_BOUND = [
  'apps/api/vitest.config.ts',
  'apps/api/vitest.coverage.config.ts',
  'apps/api/vitest.integration.config.ts',
  'apps/ops-web/vitest.config.ts',
  'apps/owner-app/vitest.config.ts',
  'apps/driver-app/vitest.config.ts',
  'packages/codemods/vitest.config.ts',
  'vitest.e2e.config.ts',
] as const;

const readCfg = (rel: string): string => codeOnly(readFileSync(resolve(repoRoot, rel), 'utf8'));

// A pool is BOUNDED if it caps worker count (maxWorkers) or refuses to run
// files in parallel at all (fileParallelism:false). Either is sufficient;
// requiring both would be cargo-culting.
const BOUND = /maxWorkers:\s*[0-9'"]|fileParallelism:\s*false/;

describe('vitest pool bounding SSOT guard', () => {
  it('finds configs to scan (guard is not vacuously green)', () => {
    expect(MUST_BOUND.length).toBeGreaterThan(5);
  });

  it('detects an unbounded config when one exists (guard actually works)', () => {
    expect(BOUND.test('export default { test: { testTimeout: 30000 } }')).toBe(false);
    expect(BOUND.test('export default { test: { maxWorkers: 2 } }')).toBe(true);
    expect(BOUND.test('export default { test: { fileParallelism: false } }')).toBe(true);
  });

  it.each(MUST_BOUND)('%s bounds its worker pool', (rel) => {
    expect(readCfg(rel)).toMatch(BOUND);
  });

  it('every pool-running config is bounded -- names the offenders', () => {
    const offenders = MUST_BOUND.filter((rel) => !BOUND.test(readCfg(rel)));
    expect(offenders).toEqual([]);
  });
});
