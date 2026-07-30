// FleetManagement/scripts/bump-turbo.test.ts
// RED->GREEN spec for the pure decision core of the //#bump:turbo task.
//
// Why a task at all (2026 rule): every project op is a registered Turbo task or
// committed root script, never a throw-away CLI. Bumping turbo was previously a
// hand-edit of the turbo devDependency spec plus a bare pnpm install -- exactly
// the uncaptured idiom the rule forbids. //#bump:turbo captures it, mirroring
// //#bump:pnpm (scripts/bump-pnpm.ts) but for an ordinary devDependency rather
// than the corepack packageManager pin.
//
// Unlike bump-pnpm.ts (an untested side-effecting script), the version logic
// here is a PURE core so it is unit-tested with zero I/O, following the
// close-worktree / host-gate house pattern: planTurboBump computes the new spec
// and a no-op verdict; the thin main() does the git-clean check, the file
// rewrite, and pnpm install.
import { describe, it, expect } from 'vitest';
import { planTurboBump } from './bump-turbo.js';

describe('planTurboBump computes the new turbo spec', () => {
  it('bumps a caret spec to the requested version, preserving the caret', () => {
    const plan = planTurboBump('^2.10.6', '2.10.7');
    expect(plan.newSpec).toBe('^2.10.7');
    expect(plan.noop).toBe(false);
  });

  it('reports a no-op when the requested version already matches the pinned one', () => {
    const plan = planTurboBump('^2.10.7', '2.10.7');
    expect(plan.noop).toBe(true);
    expect(plan.newSpec).toBe('^2.10.7');
  });

  it('preserves an exact (caretless) pin when bumping', () => {
    const plan = planTurboBump('2.10.6', '2.10.7');
    expect(plan.newSpec).toBe('2.10.7');
  });

  it('preserves a tilde range when bumping', () => {
    const plan = planTurboBump('~2.10.6', '2.10.7');
    expect(plan.newSpec).toBe('~2.10.7');
  });

  it('accepts a requested version with a leading v and normalizes it', () => {
    expect(planTurboBump('^2.10.6', 'v2.10.7').newSpec).toBe('^2.10.7');
  });

  it('rejects a requested version that is not semver, rather than writing junk', () => {
    expect(() => planTurboBump('^2.10.6', 'latest')).toThrow();
    expect(() => planTurboBump('^2.10.6', '2.10')).toThrow();
    expect(() => planTurboBump('^2.10.6', 'nonsense')).toThrow();
  });

  it('rejects an unparseable current spec rather than guessing the prefix', () => {
    expect(() => planTurboBump('', '2.10.7')).toThrow();
    expect(() => planTurboBump('workspace:*', '2.10.7')).toThrow();
  });
});
