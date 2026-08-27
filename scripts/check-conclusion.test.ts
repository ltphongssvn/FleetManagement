// scripts/check-conclusion.test.ts
// RED spec for the check-conclusion SSOT.
//
// Fixture is PR #511's OBSERVED statusCheckRollup payload (2 CANCELLED,
// 4 SKIPPED, 3 SUCCESS, zero FAILURE) -- not an invented shape. That PR was
// reported BLOCKED with "required checks failed" while carrying no failure at
// all, because `gh pr checks --json name,state` buckets CANCELLED into a
// failure-shaped state before any classifier sees it.
import { z } from 'zod';
import { describe, it, expect } from 'vitest';
import {
  CHECK_CONCLUSIONS,
  CHECK_CONCLUSION_VERDICT,
  CheckRunSchema,
  summarizeRollup,
  runVerdictFor,
  verdictFor,
} from './check-conclusion.js';

const pr511 = [
  { name: 'Install / Build / Lint / Typecheck', status: 'COMPLETED', conclusion: 'CANCELLED' },
  { name: 'Enforce reference variables', status: 'COMPLETED', conclusion: 'SUCCESS' },
  { name: 'Enforce reference variables', status: 'COMPLETED', conclusion: 'SUCCESS' },
  {
    name: 'Security guards (secrets + prod topology)',
    status: 'COMPLETED',
    conclusion: 'CANCELLED',
  },
  { name: 'API tests (shard 1/4)', status: 'COMPLETED', conclusion: 'SKIPPED' },
  { name: 'Workspace package tests (non-api)', status: 'COMPLETED', conclusion: 'SKIPPED' },
  { name: 'Coverage gate (merge + 90/90/90/90)', status: 'COMPLETED', conclusion: 'SKIPPED' },
  { name: 'Dispatch promote (develop, on success)', status: 'COMPLETED', conclusion: 'SKIPPED' },
  { name: 'GitGuardian Security Checks', status: 'COMPLETED', conclusion: 'SUCCESS' },
];

describe('CheckRunSchema (Axis 1: parse at the gh trust boundary)', () => {
  it('accepts every entry of the observed PR 511 rollup', () => {
    for (const raw of pr511) expect(() => CheckRunSchema.parse(raw)).not.toThrow();
  });

  it('accepts a null conclusion (an in-flight run has not concluded)', () => {
    expect(
      CheckRunSchema.parse({ name: 'x', status: 'IN_PROGRESS', conclusion: null }).conclusion,
    ).toBeNull();
  });

  it('rejects an unknown conclusion rather than guessing a verdict', () => {
    expect(() =>
      CheckRunSchema.parse({ name: 'x', status: 'COMPLETED', conclusion: 'BANANA' }),
    ).toThrow();
  });
});

describe('CHECK_CONCLUSION_VERDICT (totality: a new enum member must break the build)', () => {
  it('maps all nine CheckConclusionState members', () => {
    expect(CHECK_CONCLUSIONS).toHaveLength(9);
    for (const c of CHECK_CONCLUSIONS) expect(CHECK_CONCLUSION_VERDICT[c]).toBeDefined();
  });

  it('classifies genuine defects as fail', () => {
    expect(verdictFor('FAILURE')).toBe('fail');
    expect(verdictFor('STARTUP_FAILURE')).toBe('fail');
    expect(verdictFor('ACTION_REQUIRED')).toBe('fail');
  });

  it('classifies finished non-failures as pass', () => {
    expect(verdictFor('SUCCESS')).toBe('pass');
    expect(verdictFor('SKIPPED')).toBe('pass');
    expect(verdictFor('NEUTRAL')).toBe('pass');
  });

  it('classifies superseded and transient outcomes as indeterminate, never fail', () => {
    expect(verdictFor('CANCELLED')).toBe('indeterminate');
    expect(verdictFor('STALE')).toBe('indeterminate');
    expect(verdictFor('TIMED_OUT')).toBe('indeterminate');
  });

  it('treats a null conclusion as pending, not as a verdict', () => {
    expect(verdictFor(null)).toBe('pending');
  });
});

describe('summarizeRollup on the real PR 511 payload', () => {
  const sum = summarizeRollup(pr511.map((r) => CheckRunSchema.parse(r)));

  it('reports ZERO failed checks -- the bug that blocked PR 511', () => {
    expect(sum.failed).toEqual([]);
  });

  it('reports the two cancelled jobs as indeterminate', () => {
    expect(sum.indeterminate).toHaveLength(2);
    expect(sum.indeterminate).toContain('Install / Build / Lint / Typecheck');
    expect(sum.indeterminate).toContain('Security guards (secrets + prod topology)');
  });

  it('is not green -- indeterminate checks need a rerun before merging', () => {
    expect(sum.green).toBe(false);
  });

  it('needs a rerun rather than a human, which is what BLOCKED wrongly implied', () => {
    expect(sum.needsRerun).toBe(true);
  });
});

describe('confident-zero hazard (preserved from pr-automerge.ts)', () => {
  it('zero checks is NOT green: the gate has not registered yet', () => {
    const sum = summarizeRollup([]);
    expect(sum.green).toBe(false);
    expect(sum.needsRerun).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Run-level conclusions.
//
// pr-follow.ts watches WORKFLOW RUNS, not checks, and collapsed them the same
// way: `conclusion === 'success' ? 'success' : 'failed'` (lines 114 and 310 on
// origin/develop). A run cancelled by `concurrency: cancel-in-progress` therefore
// became 'failed', and computeVerdict turns a failed phase into a hard exit 1 --
// so a superseded develop run reported "FAILED at develop-gates" for a pipeline
// that was never broken. Same defect class as PR #511, different enum.
//
// Run conclusions are lowercase on the REST/gh run-list surface and are a
// SUPERSET of check conclusions: they include 'action_required' and
// 'startup_failure' plus a null while in flight. Modelled separately rather than
// forced into CheckConclusion, because the two enums are genuinely distinct
// GitHub types and merging them would be a guess.
describe('run-level conclusion classification', () => {
  it('treats a completed successful run as pass', () => {
    expect(runVerdictFor('success')).toBe('pass');
  });

  it('treats genuine run failures as fail', () => {
    expect(runVerdictFor('failure')).toBe('fail');
    expect(runVerdictFor('startup_failure')).toBe('fail');
    expect(runVerdictFor('action_required')).toBe('fail');
  });

  it('treats a cancelled run as indeterminate -- it carries no verdict', () => {
    expect(runVerdictFor('cancelled')).toBe('indeterminate');
  });

  it('treats stale and timed_out runs as indeterminate', () => {
    expect(runVerdictFor('stale')).toBe('indeterminate');
    expect(runVerdictFor('timed_out')).toBe('indeterminate');
  });

  it('treats skipped and neutral runs as pass', () => {
    expect(runVerdictFor('skipped')).toBe('pass');
    expect(runVerdictFor('neutral')).toBe('pass');
  });

  it('treats a null conclusion as pending (run still in flight)', () => {
    expect(runVerdictFor(null)).toBe('pending');
  });

  it('is case-insensitive, since gh and the REST API differ on casing', () => {
    expect(runVerdictFor('CANCELLED')).toBe('indeterminate');
    expect(runVerdictFor('Success')).toBe('pass');
  });

  it('fails closed on an unrecognised conclusion rather than calling it failed', () => {
    expect(runVerdictFor('banana')).toBe('unclassified');
  });
});

// ---- "not concluded yet" has THREE wire spellings, not one ----
// pr:automerge logged "could not parse statusCheckRollup; re-reading" on every
// poll while checks were in flight -- 11 times on PR #528, 7 on #526 -- and
// only stopped once every check had settled. The retry masked it, so it read
// as network flakiness rather than a parse bug.
//
// The cause is here. conclusion is CheckConclusionSchema.nullable(), which
// accepts null but NOT the empty string GitHub returns for a queued check, and
// not an absent key. Consumers wrap it in z.array(CheckRunSchema), so ONE such
// entry rejects the WHOLE array; safeParse returns [], and the caller reports
// the rollup as unparseable while every check in it was perfectly well-formed.
//
// This is the same confident-zero shape the surrounding code already guards
// against elsewhere: an empty list from a failed parse is indistinguishable
// from a PR that genuinely has no checks.
describe('CheckRunSchema: unconcluded spellings', () => {
  it('accepts null, the documented in-flight value', () => {
    expect(
      CheckRunSchema.safeParse({ name: 'x', status: 'IN_PROGRESS', conclusion: null }).success,
    ).toBe(true);
  });

  it('accepts the EMPTY STRING GitHub returns for a queued check', () => {
    expect(CheckRunSchema.safeParse({ name: 'x', status: 'QUEUED', conclusion: '' }).success).toBe(
      true,
    );
  });

  it('accepts an ABSENT conclusion key', () => {
    expect(CheckRunSchema.safeParse({ name: 'x', status: 'QUEUED' }).success).toBe(true);
  });

  // All three mean the same thing, so they must NORMALISE to one value -- a
  // consumer that had to branch on three spellings of "pending" would just
  // re-introduce the bug one layer up.
  it('normalises every unconcluded spelling to null', () => {
    for (const raw of [
      { name: 'x', status: 'QUEUED', conclusion: null },
      { name: 'x', status: 'QUEUED', conclusion: '' },
      { name: 'x', status: 'QUEUED' },
    ]) {
      const parsed = CheckRunSchema.parse(raw);
      expect(parsed.conclusion).toBe(null);
    }
  });

  // The tolerance must not become a hole: a value that is neither a known
  // conclusion nor an unconcluded spelling is still a contract violation.
  it('still rejects an unknown conclusion value', () => {
    expect(
      CheckRunSchema.safeParse({ name: 'x', status: 'COMPLETED', conclusion: 'BANANA' }).success,
    ).toBe(false);
  });

  // The whole point: one in-flight entry must not sink the array.
  it('parses a rollup mixing concluded and queued checks', () => {
    const rollup = [
      { name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'b', status: 'QUEUED', conclusion: '' },
      { name: 'c', status: 'IN_PROGRESS', conclusion: null },
    ];
    const res = z.array(CheckRunSchema).safeParse(rollup);
    expect(res.success).toBe(true);
  });
});
