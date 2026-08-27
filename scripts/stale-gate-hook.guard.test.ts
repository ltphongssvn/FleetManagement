// scripts/stale-gate-hook.guard.test.ts
// LEVEL 8 OF THE LADDER: prove that DELETING the wiring turns this suite red.
//
// WHAT THIS CLOSES. //#worktree:stale-gate reached level 4 and stopped. It was
// a registered turbo task with a documented rationale, a pure core that
// DELEGATES closeability to decideClose rather than re-deriving it, unit tests
// under //#test:scripts, and a fail-closed exit -- and NOTHING INVOKED IT. Not
// __ci_fast__, not a hook, not a workflow.
//
// A constraint is load-bearing ONLY IF violating it causes a structural
// failure. This one could be ignored with zero consequence, so it was
// decorative however sound its internals -- the FIFTH instance of that exact
// shape in this repo, after //#lint:scripts, //#typecheck:scripts,
// //#lint:e2e and //#estate:verify. ci.yml names the pattern outright: "real
// locally and absent remotely -- a human expectation, not an enforceable
// rule." The established answer is a guard asserting the wiring, so removing
// it fails a test instead of silently reopening the hole.
//
// IT ASSERTS THE WIRING, NOT THE VERDICT. The verdict depends on the machine's
// live estate -- which worktrees exist, what is merged, how long since a
// reflog entry -- so asserting it here would make the suite flap with whatever
// the operator happens to have checked out. What must never regress is that
// the gate is CONNECTED.
//
// WHY PRE-PUSH AND NOT CI, asserted below rather than merely intended: the
// task's own description states that a CI runner has zero worktrees, so a CI
// version would inspect an empty set and pass forever -- a gate that cannot
// fail is the very thing this guard exists to prevent.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = resolve(import.meta.dirname, '..');

interface Hook {
  readonly id: string;
  readonly entry?: string;
  readonly stages?: readonly string[];
}
interface PreCommitConfig {
  readonly repos: readonly { readonly hooks: readonly Hook[] }[];
}

function hooks(): readonly Hook[] {
  const raw = readFileSync(resolve(ROOT, '.pre-commit-config.yaml'), 'utf8');
  const config = parse(raw) as PreCommitConfig;
  return config.repos.flatMap((r) => r.hooks);
}

const HOOK_ID = 'worktree-stale-gate-push';

describe('worktree:stale-gate is wired to a gate, not merely defined', () => {
  it('the hook EXISTS in the local enforcement layer', () => {
    expect(hooks().map((h) => h.id)).toContain(HOOK_ID);
  });

  // PRE-PUSH, deliberately and necessarily. A CI runner has zero worktrees, so
  // the same check there would inspect an empty set and pass forever.
  it('runs at the PRE-PUSH stage', () => {
    const hook = hooks().find((h) => h.id === HOOK_ID);
    expect(hook?.stages).toEqual(['pre-push']);
  });

  // It must invoke the REGISTERED TASK, never the script or the tsx file
  // directly: a bare invocation is the uncaptured-op shape the repo retired.
  it('invokes the registered turbo task', () => {
    const hook = hooks().find((h) => h.id === HOOK_ID);
    expect(hook?.entry).toContain('turbo run worktree:stale-gate');
  });

  // The bash-safety contract .pre-commit-config.yaml documents: an
  // `a && b || echo` entry makes a REAL failure exit 0, silently swallowing
  // the refusal. The if/then/else form propagates the non-zero exit that
  // blocks the push -- without it this gate would be decorative in a second,
  // subtler way, present but unable to stop anything.
  it('uses the if/then/else form so a failure is never swallowed', () => {
    const entry = hooks().find((h) => h.id === HOOK_ID)?.entry ?? '';
    expect(entry).toContain('if command -v pnpm');
    expect(entry).not.toContain('|| echo');
  });

  // The gate is the pair: it stands beside estate-verify-push, which answers
  // the complementary question. estate:verify asks whether work is UNFINISHED
  // (dirty, unpushed, stashed); this asks whether FINISHED work was never
  // reclaimed. Dropping either leaves half the estate unguarded.
  it('stands beside the estate gate it complements', () => {
    const prePush = hooks()
      .filter((h) => h.stages?.includes('pre-push'))
      .map((h) => h.id);
    expect(prePush).toContain('estate-verify-push');
    expect(prePush).toContain(HOOK_ID);
  });

  it('keeps the other pre-push gates it stands beside', () => {
    const prePush = hooks()
      .filter((h) => h.stages?.includes('pre-push'))
      .map((h) => h.id);
    expect(prePush).toContain('pnpm-build-push');
    expect(prePush).toContain('pnpm-test-coverage-push');
  });

  // The config must PARSE, or every hook in it is inert -- the failure mode
  // that hid here once already: .git/hooks held only .sample files and the
  // entire local enforcement layer had never executed on this machine.
  it('the configuration parses, or no hook runs at all', () => {
    expect(hooks().length).toBeGreaterThan(10);
    for (const h of hooks()) expect(typeof h.id).toBe('string');
  });
});
