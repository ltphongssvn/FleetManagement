// scripts/ci-aggregate-gate.guard.test.ts
// THE MEMBERSHIP OF THE REQUIRED CHECK, ASSERTED IN VERSION CONTROL.
//
// ROOT CAUSE. Required status checks live in GITHUB SETTINGS while jobs live in
// ci.yml -- two sources of truth that drift by construction. security-guards is
// the receipt: built as its own named check explicitly "so the branch ruleset
// can require it", running the secret guard, test:scripts and lint:scripts, and
// never added to develop-protection or main-protection. For its whole life a PR
// could merge with every root-script guard red. Naming it in the ruleset by hand
// fixes one job and guarantees the same bug for the next.
//
// The aggregate makes membership a REVIEWABLE DIFF: one required check name,
// and every gate feeds it from this file. This test is what makes that binding
// load-bearing rather than conventional -- it runs under test:scripts, inside
// security-guards, which the aggregate requires. A job added without being
// aggregated fails the very check that enforces the aggregate.
//
// WHAT IT CANNOT ASSERT, stated rather than implied: that the RULESET requires
// "All checks passed". That lives on the remote; a test reaching the network
// would fail offline and in every fork. This covers the half that drifts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const ROOT = resolve(import.meta.dirname, '..');

interface Job {
  readonly name?: string;
  readonly if?: string;
  readonly needs?: readonly string[] | string;
  readonly steps?: readonly { readonly run?: string }[];
}

function jobs(): Record<string, Job> {
  const raw = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
  return (parse(raw) as { jobs: Record<string, Job> }).jobs;
}

const AGGREGATE = 'all-checks-passed';

// dispatch-promote is an ACTION taken after success, not a gate: requiring it
// would make every PR wait on a develop-only dispatch that never runs for a PR.
const NOT_A_GATE = new Set([AGGREGATE, 'dispatch-promote']);

describe('the aggregate gate cannot silently lose a job', () => {
  it('the aggregate job exists and is the single required check', () => {
    expect(jobs()[AGGREGATE]?.name).toBe('All checks passed');
  });

  // THE POINT OF THE FILE. A new gate job that nobody aggregates fails here.
  it('aggregates EVERY gate job defined in the workflow', () => {
    const all = jobs();
    const needs = all[AGGREGATE]?.needs ?? [];
    for (const job of Object.keys(all)) {
      if (NOT_A_GATE.has(job)) continue;
      expect(needs).toContain(job);
    }
  });

  // LOAD-BEARING: a needs: job is SKIPPED when a dependency fails, and GitHub
  // scores a skipped required check as NEUTRAL -- which PASSES. Without
  // always() the aggregate goes green precisely when a gate fails.
  it('runs with if: always(), or a failed gate SKIPS it into a pass', () => {
    expect(jobs()[AGGREGATE]?.if).toBe('always()');
  });

  // always() alone is not enough: the step must then REFUSE anything that is
  // not success, so skipped, cancelled and any future result string block.
  it('fails closed by demanding success, not by listing bad values', () => {
    const run = (jobs()[AGGREGATE]?.steps ?? []).map((s) => s.run ?? '').join('\n');
    expect(run).toContain('!= "success"');
    expect(run).toContain('exit 1');
  });

  // The second source of truth this removed: dispatch-promote used to repeat
  // the whole gate list, so a job added to one list and missed in the other
  // could let a develop push promote to PRODUCTION past an ungated check.
  it('leaves ONE gate list: dispatch-promote depends on the aggregate alone', () => {
    expect(jobs()['dispatch-promote']?.needs).toEqual([AGGREGATE]);
  });

  it('still aggregates the five gates the promote path always required', () => {
    const needs = jobs()[AGGREGATE]?.needs ?? [];
    for (const gate of ['setup', 'api-tests', 'coverage-gate', 'other-tests', 'security-guards']) {
      expect(needs).toContain(gate);
    }
  });
});
