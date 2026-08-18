// scripts/estate-verify-hook.guard.test.ts
// LEVEL 8 OF THE LADDER: prove that DELETING the wiring turns this suite red.
//
// WHAT THIS CLOSES. estate:verify reached level 4 and stopped: it was a
// registered turbo task with graded exits, a fail-closed unreadable path,
// branded state and 1380 tests -- and NOTHING INVOKED IT. Not __ci_fast__, not
// a hook, not a workflow. A verdict no execution path consumes is decorative
// however sound its internals, and the rule is explicit that only an
// unbypassable, mutation-proven control counts.
//
// This repo has hit the identical hole three times before -- //#lint:scripts,
// //#typecheck:scripts and //#lint:e2e were each wired only into a turbo node
// CI never invoked -- and ci.yml names the pattern outright: "real locally and
// absent remotely -- a human expectation, not an enforceable rule". The
// established answer is a guard test asserting the wiring, so removing it
// fails a test instead of silently reopening the hole. That is what this is.
//
// IT ASSERTS THE WIRING, NOT THE VERDICT. The verdict depends on the machine's
// live estate, so asserting it here would make the suite flap with whatever
// the operator happens to have checked out. What must never regress is that
// the gate is CONNECTED.
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

const HOOK_ID = 'estate-verify-push';

describe('estate:verify is wired to a gate, not merely defined', () => {
  it('the hook EXISTS in the local enforcement layer', () => {
    expect(hooks().map((h) => h.id)).toContain(HOOK_ID);
  });

  // PRE-PUSH, deliberately. Unpushed commits and a dirty estate are precisely
  // a pre-push concern, and the file reserves that stage for the slower gates.
  it('runs at the PRE-PUSH stage', () => {
    const hook = hooks().find((h) => h.id === HOOK_ID);
    expect(hook?.stages).toEqual(['pre-push']);
  });

  // It must invoke the REGISTERED TASK, never the script or the tsx file
  // directly: a bare invocation is the uncaptured-op shape the repo retired.
  it('invokes the registered turbo task', () => {
    const hook = hooks().find((h) => h.id === HOOK_ID);
    expect(hook?.entry).toContain('turbo run estate:verify');
  });

  // The bash-safety contract this file documents: an `a && b || echo` entry
  // makes a REAL failure exit 0, silently swallowing the refusal. The
  // if/then/else form propagates the non-zero exit that blocks the push.
  it('uses the if/then/else form so a failure is never swallowed', () => {
    const entry = hooks().find((h) => h.id === HOOK_ID)?.entry ?? '';
    expect(entry).toContain('if command -v pnpm');
    expect(entry).not.toContain('|| echo');
  });

  // The whole point: the gate is the pair. If a future edit drops the pre-push
  // stage or the task name, THIS test fails rather than the gate going quiet.
  it('keeps the other pre-push gates it stands beside', () => {
    const prePush = hooks().filter((h) => h.stages?.includes('pre-push')).map((h) => h.id);
    expect(prePush).toContain('pnpm-build-push');
    expect(prePush).toContain('pnpm-test-coverage-push');
    expect(prePush).toContain(HOOK_ID);
  });

  // The config must PARSE, or every hook in it is inert -- the failure mode
  // that hid here: .git/hooks held only .sample files and the entire local
  // enforcement layer had never executed on this machine.
  it('the configuration parses, or no hook runs at all', () => {
    expect(hooks().length).toBeGreaterThan(10);
    for (const h of hooks()) expect(typeof h.id).toBe('string');
  });
});
