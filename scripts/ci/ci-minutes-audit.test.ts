// scripts/ci/ci-minutes-audit.test.ts
// RED-first unit spec for the pure CI-minutes aggregator (outside-in TDD).
//
// WHY this exists: the /actions/workflows/{id}/timing and /actions/runs/{id}/timing
// endpoints are CLOSING DOWN per GitHub docs and return no billable data. A jq
// query with a // 0 fallback against them reported every workflow as costing zero
// minutes while billing showed 11,981 -- missing data laundered into a number.
// This aggregator computes from job records (started_at -> completed_at) instead,
// and test 4 below LOCKS the anti-regression: an absent timestamp MUST throw, so
// missing data can never again present as a plausible zero.
//
// Billing model asserted here (GitHub docs): billable job minutes are rounded UP
// to the next whole minute, PER JOB -- so parallel jobs bill in parallel and job
// count itself costs money. Linux multiplier is 1x (this repo is Linux-only).
import { describe, it, expect } from 'vitest';
import {
  JobSchema,
  billableMinutesForJob,
  summarizeBillableMinutes,
} from './ci-minutes-audit.ts';

function makeJob(over: Record<string, unknown>): unknown {
  return JobSchema.parse({
    id: 1,
    name: 'a job',
    conclusion: 'success',
    started_at: '2026-07-16T14:51:29Z',
    completed_at: '2026-07-16T14:55:46Z',
    ...over,
  });
}

describe('billableMinutesForJob', () => {
  it('rounds a part-minute job UP to the next whole minute', () => {
    // 14:51:29 -> 14:55:46 is 4m17s of wall time; GitHub bills 5.
    const j = makeJob({});
    expect(billableMinutesForJob(j as never)).toBe(5);
  });

  it('leaves an exact-minute job unrounded', () => {
    const j = makeJob({
      started_at: '2026-07-16T14:00:00Z',
      completed_at: '2026-07-16T14:03:00Z',
    });
    expect(billableMinutesForJob(j as never)).toBe(3);
  });

  it('bills a skipped zero-duration job as 0, not 1', () => {
    // The Dispatch promote job: skipped, started_at === completed_at. It must
    // not attract the round-up, or every skipped job would invent a minute.
    const j = makeJob({
      conclusion: 'skipped',
      started_at: '2026-07-16T15:00:27Z',
      completed_at: '2026-07-16T15:00:27Z',
    });
    expect(billableMinutesForJob(j as never)).toBe(0);
  });

  it('THROWS on a missing completed_at instead of returning 0', () => {
    // The whole reason this module exists. A running/queued job has no
    // completed_at; silently scoring it 0 is how a retired endpoint passed for
    // a free workflow. Absent data must be loud.
    const j = makeJob({ conclusion: null, completed_at: null });
    expect(() => billableMinutesForJob(j as never)).toThrow(/completed_at/);
  });
});

describe('summarizeBillableMinutes', () => {
  it('groups by workflow, sums billable minutes, and sorts costliest first', () => {
    const entries = [
      {
        workflowName: 'CI',
        runId: 1,
        jobs: [
          makeJob({ id: 10, started_at: '2026-07-16T14:00:00Z', completed_at: '2026-07-16T14:04:17Z' }),
          makeJob({ id: 11, started_at: '2026-07-16T14:00:00Z', completed_at: '2026-07-16T14:03:16Z' }),
        ],
      },
      {
        workflowName: 'Railway reference guard',
        runId: 2,
        jobs: [
          makeJob({ id: 12, started_at: '2026-07-16T14:51:27Z', completed_at: '2026-07-16T14:52:38Z' }),
        ],
      },
      {
        workflowName: 'Railway reference guard',
        runId: 3,
        jobs: [
          makeJob({ id: 13, started_at: '2026-07-16T14:51:26Z', completed_at: '2026-07-16T14:52:41Z' }),
        ],
      },
    ];
    const report = summarizeBillableMinutes(entries as never);
    expect(report.totalBillableMinutes).toBe(13);
    expect(report.byWorkflow[0]?.workflowName).toBe('CI');
    expect(report.byWorkflow[0]?.billableMinutes).toBe(9);
    expect(report.byWorkflow[0]?.runs).toBe(1);
    expect(report.byWorkflow[0]?.jobs).toBe(2);
    // The guard double-fires per push: two separate runs, both billed.
    expect(report.byWorkflow[1]?.workflowName).toBe('Railway reference guard');
    expect(report.byWorkflow[1]?.runs).toBe(2);
    expect(report.byWorkflow[1]?.billableMinutes).toBe(4);
  });

  it('reports an empty set as zero rather than throwing', () => {
    const report = summarizeBillableMinutes([]);
    expect(report.totalBillableMinutes).toBe(0);
    expect(report.byWorkflow).toEqual([]);
  });
});
