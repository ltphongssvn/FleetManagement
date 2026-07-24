// File: FleetManagement/scripts/ci-enforces-security-guards.guard.test.ts
//
// Meta-guard: asserts that the CI WORKFLOW ITSELF enforces the security guards.
//
// Why this test exists. The secret/topology guard was wired into the __ci_fast__
// turbo node and declared "enforced in the PR gate" -- but ci.yml never invokes
// __ci_fast__. Its jobs run build, lint/typecheck, the api shards, and
// pnpm -r ... test:coverage, and that last one only reaches WORKSPACE PACKAGES.
// The root scripts/ tree belongs to no package, so neither the guard nor its
// tests executed remotely at all. The protection was real locally and absent in
// CI: a human expectation rather than an enforceable rule.
//
// A sibling guard (ci-fast-covers-test-scripts) already asserts __ci_fast__
// covers test:scripts, and it passed throughout -- because it verifies the turbo
// graph, not the workflow. Both halves are needed; this file is the workflow half.
//
// It reads the committed workflow as DATA. If someone deletes the security job,
// renames it, drops a guard step, or lets promotion proceed without it, this
// test fails.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/ci.yml');
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

// Deliberately string-based rather than YAML-parsed: the assertion is about what
// is COMMITTED, and this keeps the test dependency-free and immune to loader
// quirks around GitHub expression syntax.
function hasLine(fragment: string): boolean {
  return workflow.includes(fragment);
}

describe('ci.yml enforces the security guards', () => {
  it('defines a dedicated security-guards job', () => {
    // A separate job, not a step buried in setup, so it surfaces as its own
    // named check that a branch ruleset can require.
    expect(hasLine('security-guards:')).toBe(true);
    expect(hasLine('Security guards (secrets + prod topology)')).toBe(true);
  });

  it('runs the secret + production-topology guard', () => {
    // The boundary itself: a non-zero exit fails the job, which fails the PR.
    expect(hasLine('pnpm run guard:local-secrets')).toBe(true);
  });

  it('runs the root-script tests that verify the guards themselves', () => {
    // A guard is only trustworthy if its own logic is tested, and no other job
    // in this workflow reaches root scripts/.
    expect(hasLine('pnpm run test:scripts')).toBe(true);
  });

  it('lints the root scripts the guards are written in', () => {
    // scripts/ belongs to no workspace package, so the package-scoped lint task
    // never reached it: this tooling was unlinted for the life of the repo, and
    // enabling it surfaced 122 real type-aware violations. Keep it gated.
    expect(hasLine('pnpm run lint:scripts')).toBe(true);
  });

  it('blocks promotion to production until the guards pass', () => {
    // Without this, a develop push could promote to PRODUCTION while the guard
    // is still running or failing -- defeating the purpose of a boundary.
    const needsLine = workflow
      .split(/(?:\r\n|\r|\n)/)
      .find((l) => l.trim().startsWith('needs:') && l.includes('coverage-gate'));
    expect(needsLine).toBeDefined();
    expect(needsLine ?? '').toContain('security-guards');
  });

  it('keeps the guard on pull_request, where the boundary must sit', () => {
    // The control has to stop the change BEFORE it reaches the repository's
    // protected branches, not report on it afterwards.
    expect(hasLine('pull_request:')).toBe(true);
  });
});
