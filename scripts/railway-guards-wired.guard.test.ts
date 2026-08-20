// scripts/railway-guards-wired.guard.test.ts
//
// META-GUARD: asserts the WORKFLOW ITSELF still runs the Railway guards.
//
// Why this exists. A guard is load-bearing only if violating it breaks the
// pipeline. keycloak-memory-guard.ts can be perfect and enforce nothing the
// moment its job is deleted, renamed, or has its run step dropped -- and the
// unit tests for the guard's own logic would keep passing throughout, because
// they verify the DECISION, not the WIRING.
//
// This repo has already paid for that distinction. ci.yml's header records it:
// the secret/topology guard was wired into the __ci_fast__ turbo node and
// declared "enforced in the PR gate", but ci.yml never invokes __ci_fast__, so
// "the protection was real locally and absent remotely -- a human expectation,
// not an enforceable rule". ci-enforces-security-guards.guard.test.ts is the
// workflow half for THAT job; this file is the workflow half for these two.
//
// Deliberately string-based rather than YAML-parsed, matching its sibling: the
// assertion is about what is COMMITTED, and this keeps the test dependency-free
// and immune to loader quirks around GitHub expression syntax.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/railway-guard.yml');
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

const hasLine = (fragment: string): boolean => workflow.includes(fragment);

describe('the Railway guards are wired into the workflow', () => {
  it('defines the reference-variable job', () => {
    expect(hasLine('Enforce reference variables')).toBe(true);
    expect(hasLine('pnpm guard:railway-references')).toBe(true);
  });

  it('defines the Keycloak memory job', () => {
    expect(hasLine('keycloak-memory:')).toBe(true);
    expect(hasLine('Enforce Keycloak memory envelope')).toBe(true);
    expect(hasLine('pnpm guard:keycloak-memory')).toBe(true);
  });

  it('keeps them as SEPARATE jobs so both report on one run', () => {
    // As sequential steps the first failure hides the second; as independent
    // jobs they run concurrently and each surfaces its own named check.
    expect(hasLine('  guard:')).toBe(true);
    expect(hasLine('  keycloak-memory:')).toBe(true);
  });

  it('installs the Railway CLI both jobs shell out to', () => {
    // Without it the guards exit 2 (tooling) on every run, which fails closed
    // but for the wrong reason and would be read as a policy violation.
    const installs = workflow.split('npm install -g @railway/cli').length - 1;
    expect(installs).toBe(2);
  });

  it('runs on push, which is what Wait-for-CI gates the deploy on', () => {
    // The enforcement point is the DEPLOY, not the merge: live-state drift is
    // caused by dashboard edits, not by the PR under review.
    expect(hasLine('push:')).toBe(true);
  });

  it('gates every step on the token so a forked PR is not blocked', () => {
    // Fork safety, and its cost is documented in the workflow header: GitHub
    // reports a conditionally skipped job as SUCCESS, so on a fork these checks
    // go green having verified nothing. Acceptable only because a fork cannot
    // deploy.
    expect(hasLine('HAS_RAILWAY_TOKEN')).toBe(true);
  });
});

describe('the guard scripts the workflow invokes actually exist', () => {
  const pkg = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts: Record<string, string> };

  it.each(['guard:railway-references', 'guard:keycloak-memory'])(
    'package.json registers %s',
    (name) => {
      // A workflow calling an unregistered script fails with "command not
      // found", which reads as a tooling error rather than the missing gate it
      // actually is.
      expect(typeof pkg.scripts[name]).toBe('string');
    },
  );
});
