// scripts/pr-follow-failed-workflows.test.ts
// RED-first: when a phase fails, pr:follow must name WHICH workflow failed and
// where to look -- not merely which phase.
//
// REAL COST (2026-08-11). A boot crash in the API container made the E2E
// workflow fail. pr:follow reported exactly this and nothing more:
//
//   x  develop-gates
//   FAILED at develop-gates -- PR #560 did NOT reach production.
//
// develop-gates aggregates TWO workflows -- CI and E2E (Playwright) -- into one
// boolean, so that line cannot distinguish "a unit test failed" from "the
// container never started". Those need completely different first moves: the
// former is a code diff, the latter is a container log. Finding out which cost
// a manual hunt through workflow logs -- precisely the hunt this tool exists to
// remove.
//
// The tool already solves this ONE PHASE EARLIER: pr-checks prints
// "failing: <check names>". The precedent was simply never applied to the
// aggregated phases.
//
// 2026 CI-observability guidance states the rule plainly: tools that stop at
// the surface, showing failed jobs without the context of WHERE the fault lies,
// are the problem; a report must show the failing step and a link so the
// developer knows exactly where to look.
//
// THE RULE: a failure verdict must carry enough to start the next action. A
// phase name is a pointer to a question; the workflow name and run URL are the
// beginning of the answer.
import { describe, it, expect } from 'vitest';
import {
  failedWorkflowsFor,
  describeFailure,
  runUrl,
  CI_WORKFLOW,
  E2E_WORKFLOW,
  type RunRecord,
} from './pr-follow.js';

// Deliberately NOT hex: a plausible-looking SHA fixture trips detect-secrets
// as a high-entropy string, and the house rule forbids allowlist pragmas --
// so the fixture is made obviously non-secret instead of the detector
// silenced. shaMatches only requires length >= 7 and prefix semantics, both
// of which these satisfy.
const SHA = 'mergesha-under-test';
const REPO = 'ltphongssvn/FleetManagement';

function run(over: Partial<RunRecord> = {}): RunRecord {
  return {
    databaseId: 111,
    workflowName: CI_WORKFLOW,
    status: 'completed',
    conclusion: 'success',
    headSha: SHA,
    createdAt: '2026-08-11T03:12:25Z',
    event: 'push',
    ...over,
  };
}

describe('failedWorkflowsFor - names the workflow, not just the phase', () => {
  it('returns nothing when every workflow passed', () => {
    const runs = [run(), run({ workflowName: E2E_WORKFLOW, databaseId: 222 })];
    expect(failedWorkflowsFor(runs, [CI_WORKFLOW, E2E_WORKFLOW], SHA)).toEqual([]);
  });

  it('names E2E when only E2E failed -- the real incident', () => {
    const runs = [
      run(),
      run({ workflowName: E2E_WORKFLOW, databaseId: 31454708107, conclusion: 'failure' }),
    ];
    const failed = failedWorkflowsFor(runs, [CI_WORKFLOW, E2E_WORKFLOW], SHA);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.workflowName).toBe(E2E_WORKFLOW);
    expect(failed[0]?.databaseId).toBe(31454708107);
  });

  it('names CI when only CI failed', () => {
    const runs = [
      run({ conclusion: 'failure' }),
      run({ workflowName: E2E_WORKFLOW, databaseId: 222 }),
    ];
    expect(failedWorkflowsFor(runs, [CI_WORKFLOW, E2E_WORKFLOW], SHA).map((f) => f.workflowName))
      .toEqual([CI_WORKFLOW]);
  });

  it('names both when both failed', () => {
    const runs = [
      run({ conclusion: 'failure' }),
      run({ workflowName: E2E_WORKFLOW, databaseId: 222, conclusion: 'failure' }),
    ];
    expect(failedWorkflowsFor(runs, [CI_WORKFLOW, E2E_WORKFLOW], SHA)).toHaveLength(2);
  });

  it('ignores a cancelled run -- superseded is not failed', () => {
    // The PR #511 lesson, preserved: cancel-in-progress is correct CI
    // configuration and must never be reported as a hard failure.
    expect(failedWorkflowsFor([run({ conclusion: 'cancelled' })], [CI_WORKFLOW], SHA)).toEqual([]);
  });

  it('ignores a run for a different SHA', () => {
    const runs = [run({ headSha: 'other-sha-entirely', conclusion: 'failure' })];
    expect(failedWorkflowsFor(runs, [CI_WORKFLOW], SHA)).toEqual([]);
  });

  it('reports only the NEWEST run per workflow, so a re-run clears an old failure', () => {
    const runs = [
      run({ databaseId: 1, conclusion: 'failure', createdAt: '2026-08-11T03:00:00Z' }),
      run({ databaseId: 2, conclusion: 'success', createdAt: '2026-08-11T04:00:00Z' }),
    ];
    expect(failedWorkflowsFor(runs, [CI_WORKFLOW], SHA)).toEqual([]);
  });

  it('ignores a still-running workflow', () => {
    const runs = [run({ status: 'in_progress', conclusion: null })];
    expect(failedWorkflowsFor(runs, [CI_WORKFLOW], SHA)).toEqual([]);
  });
});

describe('runUrl - the link the operator actually needs', () => {
  it('builds a github run URL from the repo and run id', () => {
    expect(runUrl(REPO, 31454708107)).toBe(
      'https://github.com/' + REPO + '/actions/runs/31454708107',
    );
  });
});

describe('describeFailure - the message carries the next action', () => {
  it('names the phase when no workflow detail is available', () => {
    expect(describeFailure('promoted', [], REPO)).toContain('promoted');
  });

  it('names the failing workflow and links its run', () => {
    const msg = describeFailure('develop-gates', [
      { workflowName: E2E_WORKFLOW, databaseId: 31454708107 },
    ], REPO);
    expect(msg).toContain('develop-gates');
    expect(msg).toContain(E2E_WORKFLOW);
    expect(msg).toContain('https://github.com/' + REPO + '/actions/runs/31454708107');
  });

  it('lists both workflows when both failed', () => {
    const msg = describeFailure('develop-gates', [
      { workflowName: CI_WORKFLOW, databaseId: 1 },
      { workflowName: E2E_WORKFLOW, databaseId: 2 },
    ], REPO);
    expect(msg).toContain(CI_WORKFLOW);
    expect(msg).toContain(E2E_WORKFLOW);
  });
});
