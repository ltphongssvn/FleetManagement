// scripts/pr-follow.test.ts
// Contract for the pure decision core behind pr:follow.
//
// The task exists because a merged PR is NOT done: it must clear develop CI +
// E2E, promote to main, cut a release, clear main E2E, and only then deploy to
// Railway. With hundreds of PRs, following that chain by hand is what strands
// them. Every decision here is pure so the chain logic is testable without a
// network, matching the house pattern used by host-gate and inspect-prod-deploy.
import { describe, it, expect } from 'vitest';
import {
  summarizeChecks,
  runStateFor,
  deployRunAfter,
  computeVerdict,
  RunRecordSchema,
  CheckRunSchema,
  DEPLOY_WORKFLOW,
  type PhaseResult,
} from './pr-follow';

const run = (over: Record<string, unknown> = {}): unknown => ({
  databaseId: 1,
  workflowName: 'CI',
  status: 'completed',
  conclusion: 'success',
  headSha: 'a'.repeat(40),
  createdAt: '2026-07-27T10:00:00Z',
  event: 'push',
  ...over,
});

describe('CheckRunSchema / RunRecordSchema (trust boundary)', () => {
  it('parses the gh JSON shape', () => {
    expect(() => RunRecordSchema.parse(run())).not.toThrow();
    expect(() => CheckRunSchema.parse({
      name: 'CI/Build', state: 'SUCCESS',
    })).not.toThrow();
  });

  it('rejects a malformed record rather than guessing', () => {
    expect(() => RunRecordSchema.parse(run({ databaseId: 'nope' }))).toThrow();
  });

  it('accepts a null conclusion for an in-flight run', () => {
    const parsed = RunRecordSchema.parse(run({ status: 'in_progress', conclusion: null }));
    expect(parsed.conclusion).toBeNull();
  });
});

describe('summarizeChecks', () => {
  it('is green when every check succeeded', () => {
    const s = summarizeChecks([
      { name: 'CI/Build', state: 'SUCCESS' },
      { name: 'CI/Tests', state: 'SUCCESS' },
    ]);
    expect(s.green).toBe(true);
    expect(s.settled).toBe(true);
    expect(s.failed).toEqual([]);
  });

  it('treats SKIPPED and NEUTRAL as non-failing', () => {
    // The promote dispatcher legitimately reports SKIPPED on a PR.
    const s = summarizeChecks([
      { name: 'CI/Dispatch promote', state: 'SKIPPED' },
      { name: 'CI/Build', state: 'NEUTRAL' },
    ]);
    expect(s.green).toBe(true);
  });

  it('is unsettled while any check is still running', () => {
    const s = summarizeChecks([
      { name: 'CI/Build', state: 'SUCCESS' },
      { name: 'CI/E2E', state: 'IN_PROGRESS' },
    ]);
    expect(s.settled).toBe(false);
    expect(s.green).toBe(false);
    expect(s.pending).toEqual(['CI/E2E']);
  });

  it('names every failure at once, not just the first', () => {
    const s = summarizeChecks([
      { name: 'CI/Build', state: 'FAILURE' },
      { name: 'CI/E2E', state: 'TIMED_OUT' },
      { name: 'CI/Lint', state: 'SUCCESS' },
    ]);
    expect(s.settled).toBe(true);
    expect(s.green).toBe(false);
    expect(s.failed).toEqual(['CI/Build', 'CI/E2E']);
  });

  it('is not green when there are no checks at all', () => {
    // Zero checks means the gate has not registered yet; calling that green
    // would let the follower march past an ungated PR.
    expect(summarizeChecks([]).green).toBe(false);
  });
});

describe('runStateFor', () => {
  const sha = 'b'.repeat(40);
  const runs = [
    RunRecordSchema.parse(run({ workflowName: 'CI', headSha: sha })),
    RunRecordSchema.parse(run({
      workflowName: 'E2E (Playwright)', headSha: sha,
      status: 'in_progress', conclusion: null,
    })),
    RunRecordSchema.parse(run({ workflowName: 'CI', headSha: 'c'.repeat(40), conclusion: 'failure' })),
  ];

  it('matches on workflow AND head sha, never on recency', () => {
    // Guards the class of bug fixed in a006e8b: waiting on the LATEST run
    // rather than the run for THIS commit.
    expect(runStateFor(runs, 'CI', sha)).toBe('success');
  });

  it('reports pending for an in-flight run', () => {
    expect(runStateFor(runs, 'E2E (Playwright)', sha)).toBe('pending');
  });

  it('reports absent when no run exists for that sha yet', () => {
    expect(runStateFor(runs, 'Release', sha)).toBe('absent');
  });

  it('reports failed for a failing conclusion', () => {
    expect(runStateFor(runs, 'CI', 'c'.repeat(40))).toBe('failed');
  });

  it('prefers the newest run when a workflow was re-run for the same sha', () => {
    const older = RunRecordSchema.parse(run({
      workflowName: 'CI', headSha: sha, conclusion: 'failure',
      createdAt: '2026-07-27T09:00:00Z',
    }));
    const newer = RunRecordSchema.parse(run({
      workflowName: 'CI', headSha: sha, conclusion: 'success',
      createdAt: '2026-07-27T11:00:00Z',
    }));
    expect(runStateFor([older, newer], 'CI', sha)).toBe('success');
    expect(runStateFor([newer, older], 'CI', sha)).toBe('success');
  });
});

describe('deployRunAfter', () => {
  // The deploy is triggered by workflow_run, and GitHub reports such a run
  // against the DEFAULT branch head -- not the main sha being deployed. So it
  // cannot be matched by sha at all; the only sound correlation is the first
  // workflow_run-triggered deploy created after the gating main E2E finished.
  const gateFinished = '2026-07-27T16:50:00Z';

  it('ignores deploy runs that predate the gating run', () => {
    const runs = [RunRecordSchema.parse(run({
      workflowName: DEPLOY_WORKFLOW, event: 'workflow_run',
      createdAt: '2026-07-27T14:41:00Z',
    }))];
    expect(deployRunAfter(runs, gateFinished)).toBeNull();
  });

  it('selects the earliest qualifying run, not the newest', () => {
    const first = RunRecordSchema.parse(run({
      databaseId: 10, workflowName: DEPLOY_WORKFLOW, event: 'workflow_run',
      createdAt: '2026-07-27T17:06:00Z',
    }));
    const later = RunRecordSchema.parse(run({
      databaseId: 11, workflowName: DEPLOY_WORKFLOW, event: 'workflow_run',
      createdAt: '2026-07-27T18:00:00Z',
    }));
    expect(deployRunAfter([later, first], gateFinished)?.databaseId).toBe(10);
  });

  it('ignores a manual workflow_dispatch deploy', () => {
    const runs = [RunRecordSchema.parse(run({
      workflowName: DEPLOY_WORKFLOW, event: 'workflow_dispatch',
      createdAt: '2026-07-27T17:06:00Z',
    }))];
    expect(deployRunAfter(runs, gateFinished)).toBeNull();
  });

  it('ignores a different workflow that ran in the same window', () => {
    const runs = [RunRecordSchema.parse(run({
      workflowName: 'Release', event: 'workflow_run',
      createdAt: '2026-07-27T17:06:00Z',
    }))];
    expect(deployRunAfter(runs, gateFinished)).toBeNull();
  });
});

describe('computeVerdict', () => {
  const ok = (phase: PhaseResult['phase']): PhaseResult => ({ phase, state: 'success' });

  it('is DEPLOYED with exit 0 only when every phase succeeded', () => {
    const v = computeVerdict([
      ok('pr-checks'), ok('pr-merged'), ok('develop-gates'),
      ok('promoted'), ok('release'), ok('main-e2e'), ok('deploy'),
    ]);
    expect(v.verdict).toBe('DEPLOYED');
    expect(v.exitCode).toBe(0);
    expect(v.at).toBeNull();
  });

  it('reports FAILED at the first failing phase and exits non-zero', () => {
    const v = computeVerdict([
      ok('pr-checks'), ok('pr-merged'),
      { phase: 'develop-gates', state: 'failed' },
      { phase: 'promoted', state: 'absent' },
    ]);
    expect(v.verdict).toBe('FAILED');
    expect(v.at).toBe('develop-gates');
    expect(v.exitCode).toBe(1);
  });

  it('reports WAITING when a phase is still pending', () => {
    const v = computeVerdict([ok('pr-checks'), { phase: 'develop-gates', state: 'pending' }]);
    expect(v.verdict).toBe('WAITING');
    expect(v.at).toBe('develop-gates');
    expect(v.exitCode).toBe(2);
  });

  it('never claims DEPLOYED on an incomplete chain', () => {
    // A confident zero is the hazard this whole task exists to remove.
    const v = computeVerdict([ok('pr-checks'), ok('pr-merged')]);
    expect(v.verdict).not.toBe('DEPLOYED');
    expect(v.exitCode).not.toBe(0);
  });
});
