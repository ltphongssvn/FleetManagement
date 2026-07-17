// scripts/ci/ci-minutes-fetch.test.ts
// RED: locks the runs/jobs fetch contract before the module exists.
// Pure parts only -- URL construction, pagination arithmetic, wire schemas and
// the run/jobs join. No network (resolve-ci-sha.test.ts precedent: 18 tests,
// zero vi.mock, because the I/O is segregated into main()).
import { describe, it, expect } from 'vitest';
import {
  buildRunsUrl,
  buildJobsUrl,
  RunsPageSchema,
  JobsPageSchema,
  hasMorePages,
  assertNotTruncated,
  toRunEntries,
} from './ci-minutes-fetch.js';

const API = 'https://api.github.com';
const REPO = 'ltphongssvn/FleetManagement';

describe('buildRunsUrl', () => {
  it('scopes by created range and pages at 100', () => {
    const u = buildRunsUrl(API, REPO, '2026-07-01..2026-07-16', 1);
    expect(u).toContain('/repos/ltphongssvn/FleetManagement/actions/runs');
    expect(u).toContain('created=2026-07-01..2026-07-16');
    expect(u).toContain('per_page=100');
    expect(u).toContain('page=1');
  });
  it('emits no raw spaces and advances the page', () => {
    const u = buildRunsUrl(API, REPO, '2026-07-01..2026-07-16', 2);
    expect(u).not.toContain(' ');
    expect(u).toContain('page=2');
  });
});

describe('buildJobsUrl', () => {
  it('targets the per-run jobs endpoint, never the retired timing endpoint', () => {
    const u = buildJobsUrl(API, REPO, 29508487737, 1);
    expect(u).toContain('/actions/runs/29508487737/jobs');
    expect(u).not.toContain('timing');
    expect(u).toContain('per_page=100');
  });
});

describe('hasMorePages', () => {
  it('continues while a full page came back', () => {
    expect(hasMorePages(100, 100)).toBe(true);
  });
  it('stops on a short page', () => {
    expect(hasMorePages(37, 100)).toBe(false);
  });
  it('stops on an empty page', () => {
    expect(hasMorePages(0, 100)).toBe(false);
  });
});

describe('assertNotTruncated', () => {
  // The /actions/runs list endpoint caps at 1000 results no matter how you
  // paginate. A run that pulls exactly 1000 has almost certainly hit the
  // ceiling, not exhausted the month -- observed: July returned 1000/1000
  // while billing showed 11,959 minutes. Silently accepting the cap would
  // under-report the total and make reconciliation meaningless, which is the
  // same class of failure as a confident zero: a plausible number that is not
  // the truth. total_count is the wire telling us how many really exist.
  it('passes when the fetched count matches total_count', () => {
    expect(() => assertNotTruncated(37, 37)).not.toThrow();
  });
  it('THROWS when total_count exceeds what pagination could return', () => {
    expect(() => assertNotTruncated(1000, 2431)).toThrow(/truncat/i);
  });
  it('names the API ceiling in the error so the window can be narrowed', () => {
    expect(() => assertNotTruncated(1000, 2431)).toThrow(/1000/);
  });
  it('does not throw when fewer than the ceiling came back', () => {
    expect(() => assertNotTruncated(950, 950)).not.toThrow();
  });
});

describe('RunsPageSchema', () => {
  it('parses the runs wire shape', () => {
    const parsed = RunsPageSchema.parse({
      total_count: 1,
      workflow_runs: [{ id: 1, name: 'CI', run_started_at: '2026-07-16T10:00:00Z' }],
    });
    expect(parsed.workflow_runs[0]?.name).toBe('CI');
  });
  it('rejects a payload missing workflow_runs rather than reading it as an empty month', () => {
    expect(() => RunsPageSchema.parse({ total_count: 0 })).toThrow();
  });
  it('accepts a null workflow name without inventing one', () => {
    const parsed = RunsPageSchema.parse({
      total_count: 1,
      workflow_runs: [{ id: 2, name: null, run_started_at: '2026-07-16T10:00:00Z' }],
    });
    expect(parsed.workflow_runs[0]?.name).toBeNull();
  });
});

describe('JobsPageSchema', () => {
  it('parses the jobs wire shape with nullable completion', () => {
    const parsed = JobsPageSchema.parse({
      total_count: 1,
      jobs: [{ id: 9, name: 'build', conclusion: null, started_at: '2026-07-16T10:00:00Z', completed_at: null }],
    });
    expect(parsed.jobs[0]?.completed_at).toBeNull();
  });
  it('rejects a payload missing jobs', () => {
    expect(() => JobsPageSchema.parse({ total_count: 0 })).toThrow();
  });
});

describe('toRunEntries', () => {
  const JOB = { id: 9, name: 'build', conclusion: 'success', started_at: '2026-07-16T10:00:00Z', completed_at: '2026-07-16T10:09:00Z' };
  it('joins runs to their jobs, carrying the workflow name', () => {
    const entries = toRunEntries(
      [{ id: 1, name: 'CI', run_started_at: '2026-07-16T10:00:00Z' }],
      new Map([[1, [JOB]]]),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]?.workflowName).toBe('CI');
    expect(entries[0]?.jobs).toHaveLength(1);
  });
  it('THROWS when a run has no jobs entry -- a run that billed minutes must not vanish silently', () => {
    expect(() => toRunEntries(
      [{ id: 1, name: 'CI', run_started_at: '2026-07-16T10:00:00Z' }],
      new Map(),
    )).toThrow(/1/);
  });
  it('names an unnamed workflow explicitly rather than dropping it from attribution', () => {
    const entries = toRunEntries(
      [{ id: 3, name: null, run_started_at: '2026-07-16T10:00:00Z' }],
      new Map([[3, [JOB]]]),
    );
    expect(entries[0]?.workflowName).toBe('(unnamed workflow)');
  });
});
