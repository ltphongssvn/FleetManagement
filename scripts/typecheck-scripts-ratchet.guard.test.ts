// scripts/typecheck-scripts-ratchet.guard.test.ts
//
// Ratchet: the scripts/ typecheck error count may FALL but never RISE.
//
// WHY A RATCHET AND NOT A GATE
// Nothing had ever typechecked scripts/ -- the package-scoped typecheck task
// cannot reach a tree that belongs to no workspace package, and //#lint:scripts
// is type-AWARE but reports lint rules only, so it builds a TS program and never
// surfaces the general diagnostic set. Registering //#typecheck:scripts revealed
// 89 pre-existing errors. Correcting scripts/tsconfig.json (module ESNext +
// moduleResolution Bundler + allowImportingTsExtensions, matching the proven
// e2e/tsconfig.json precedent) removed 31 that were the compiler being misled
// about a tsx/vitest-executed, never-emitted tree. 58 real defects remain.
//
// Wiring //#typecheck:scripts into __ci_fast__ today would make every branch in
// a ~50-worktree estate unmergeable at once, and teach everyone to ignore the
// tool. That is the adoption reasoning //#knip already documents for this repo:
// report first, burn down, then promote to a gate. This guard is the "burn down"
// half -- without it the count silently grows back and the task becomes noise.
//
// WHY THE COUNT IS NOT SIMPLY FIXED HERE
// 22 of the 58 (TS2345, the close-worktree fixture family) are ALREADY being
// fixed on the unpushed chore/worktree-sweep-task branch, which added a second
// required field (idleHours) and a makeCloseInput factory that does not exist on
// develop yet. Fixing them here would put two branches on the same files with
// different solutions and lose one terminal's work.
//
// HOW TO LOWER IT: fix errors, run the task, set MAX to the new number in the
// same commit. When it reaches 0, delete this guard and add //#typecheck:scripts
// to __ci_fast__ in turbo.jsonc -- ci-fast-covers-test-scripts.guard.test.ts is
// the precedent for asserting that wiring.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// Lower this as errors are fixed. NEVER raise it.
const MAX_ERRORS = 58;

const REPO_ROOT = join(import.meta.dirname, '..');

function typecheckErrorCount(): number {
  const r = spawnSync('pnpm', ['run', '--silent', 'typecheck:scripts'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // encoding:'utf-8' makes spawnSync type both streams as string, never null,
  // so a ?? fallback here is provably dead code (no-unnecessary-condition).
  const out = r.stdout + r.stderr;
  // An unreadable run is NOT zero errors. A confident zero here would silently
  // retire the ratchet -- the same hazard summarizeRollup refuses for checks.
  if (out.trim().length === 0) {
    throw new Error('typecheck:scripts produced no output; cannot trust a zero');
  }
  return (out.match(/error TS[0-9]+/g) ?? []).length;
}

describe('ratchet: scripts/ typecheck errors may fall, never rise', () => {
  it('does not exceed the recorded ceiling', () => {
    const count = typecheckErrorCount();
    expect(count).toBeLessThanOrEqual(MAX_ERRORS);
  }, 120_000);

  it('reminds the author to lower MAX_ERRORS when the count drops', () => {
    const count = typecheckErrorCount();
    // Not a failure -- a visible nudge. Tightening the ceiling is a deliberate
    // edit in the same commit as the fix, never an automatic rewrite.
    if (count < MAX_ERRORS) {
      console.log(
        '[ratchet] scripts/ typecheck errors fell to ' + String(count) +
        ' (ceiling ' + String(MAX_ERRORS) + '). Lower MAX_ERRORS in this file.',
      );
    }
    expect(count).toBeGreaterThanOrEqual(0);
  }, 120_000);
});
