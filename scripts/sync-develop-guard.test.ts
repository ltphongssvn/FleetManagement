// scripts/sync-develop-guard.test.ts
// Contract for the pre-push sync-down ENFORCEMENT guard (2026-07-10).
// Root cause the guard closes: sync:develop was a manual STANDING RULE, so a
// parked feature branch silently drifted behind origin/develop (observed:
// fix/ops-web-cf-beacon-no-transform at 16 behind) and could still be pushed
// and PR'd stale. The guard fails the push when behind, pointing at the fix.
//
// Design under test (pure decision, no git I/O): evaluateGuard(branch, behind)
//  - integration branches (develop/main/HEAD) are NEVER gated -- sync:worktrees
//    owns those, FF-only; gating them would be wrong.
//  - behind <= 0 -> allow (push proceeds).
//  - behind > 0 -> BLOCK, and the message MUST name the exact remedy command
//    (pnpm exec turbo run sync:develop) so the dev is never left guessing.
// Why a guard, not an auto-merge: a pre-push hook that ran git merge would
// create a commit the in-flight push cannot include (git cannot change the
// refs it is already sending), so the branch would push stale -- the very
// drift being prevented. A non-zero exit cleanly aborts the push instead.
// Pattern per house precedent: pure module in scripts/ + colocated test, run
// via root vitest directly (cf. scripts/compose-identity.test.ts).
import { describe, it, expect } from 'vitest';
import { evaluateGuard } from './sync-develop-guard.js';

describe('sync-develop-guard: integration branches are never gated', () => {
  it('develop is not blocked regardless of the count', () => {
    const d = evaluateGuard('develop', 5);
    expect(d.block).toBe(false);
    expect(d.message).toContain('integration branch');
  });
  it('main is not blocked', () => {
    expect(evaluateGuard('main', 99).block).toBe(false);
  });
  it('detached HEAD is not blocked', () => {
    expect(evaluateGuard('HEAD', 3).block).toBe(false);
  });
});

describe('sync-develop-guard: up-to-date feature branch is allowed', () => {
  it('behind 0 -> push allowed', () => {
    const d = evaluateGuard('feature/x', 0);
    expect(d.block).toBe(false);
    expect(d.message).toContain('up to date');
  });
  it('a negative/degraded count is treated as not-behind (fail open)', () => {
    expect(evaluateGuard('feature/x', -1).block).toBe(false);
  });
});

describe('sync-develop-guard: a behind feature branch is BLOCKED with the remedy', () => {
  it('behind 1 -> blocked', () => {
    expect(evaluateGuard('feature/x', 1).block).toBe(true);
  });
  it('the block message names the branch, the count, and the exact fix command', () => {
    const d = evaluateGuard('fix/ops-web-cf-beacon-no-transform', 16);
    expect(d.block).toBe(true);
    expect(d.message).toContain('fix/ops-web-cf-beacon-no-transform');
    expect(d.message).toContain('16');
    expect(d.message).toContain('pnpm exec turbo run sync:develop');
  });
  it('offers the infra-only bypass so the gate is escapable when justified', () => {
    const d = evaluateGuard('feature/x', 2);
    expect(d.message).toContain('--no-verify');
  });
});
