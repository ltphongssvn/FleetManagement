// scripts/ci/ci-minutes-audit.ts
// Pure CI-minutes aggregator: attribute BILLABLE GitHub Actions minutes to the
// workflow that spent them, computed from job records rather than the retired
// /actions/workflows/{id}/timing endpoint (GitHub docs: that endpoint and
// /actions/runs/{id}/timing are closing down; they return no billable data, and
// a jq fallback of // 0 against them silently reports every workflow as free).
//
// Billing model (GitHub docs):
//   - billable minutes are metered on JOB EXECUTION, not run wall-clock (run
//     duration includes queue time, which is not billed)
//   - each job is rounded UP to the next whole minute, INDEPENDENTLY -- so
//     parallel jobs bill in parallel and job count itself costs money
//   - Linux multiplier is 1x; this repo is Linux-only, so minutes == billed
//
// Absent data is an ERROR, never a zero. That rule is the whole point of this
// module and is locked by a unit spec.
import { z } from 'zod';

/** A GitHub Actions job record, narrowed to the members billing depends on.
 * started_at/completed_at are nullable at the WIRE (a queued or in-flight job
 * has no completion) -- the schema accepts that shape honestly and the
 * computation refuses it loudly, rather than the schema lying about the wire. */
export const JobSchema = z.object({
  id: z.number(),
  name: z.string(),
  conclusion: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  // null when no runner was ever assigned -- the wire stating that execution
  // never began. Optional because older payloads omit it entirely.
  runner_name: z.string().nullable().optional(),
});
export type Job = z.infer<typeof JobSchema>;

/** One workflow run plus the jobs it actually executed. */
export const RunEntrySchema = z.object({
  workflowName: z.string(),
  runId: z.number(),
  jobs: z.array(JobSchema),
});
export type RunEntry = z.infer<typeof RunEntrySchema>;

export interface WorkflowCost {
  readonly workflowName: string;
  readonly billableMinutes: number;
  readonly runs: number;
  readonly jobs: number;
}

export interface BillableReport {
  readonly totalBillableMinutes: number;
  readonly byWorkflow: readonly WorkflowCost[];
}

/** Billable minutes for ONE job: ceil(execution seconds / 60).
 * Throws on any absent or unparseable timestamp -- see module header. */
export function billableMinutesForJob(job: Job): number {
  // A SKIPPED job never reached a runner (runner_name is null) so it executed
  // for no time and billed nothing -- GitHub meters job EXECUTION. Its
  // timestamps are stamped from bookkeeping rather than a runner clock, and
  // are observed to land up to a second out of order (job 87772384101:
  // started 00:11:45Z, completed 00:11:44Z). That is not corrupt data and it
  // is not a confident zero -- it is the observed ABSENCE of work, so 0 is the
  // honest answer. The inverted-timestamp guard below still applies to every
  // job that actually ran, where inversion would be real corruption.
  if (job.started_at === null) {
    throw new Error('job ' + String(job.id) + ': missing started_at -- refusing to score it 0');
  }
  if (job.completed_at === null) {
    throw new Error('job ' + String(job.id) + ': missing completed_at -- refusing to score it 0');
  }
  const start = Date.parse(job.started_at);
  const end = Date.parse(job.completed_at);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error('job ' + String(job.id) + ': unparseable started_at/completed_at');
  }
  const ms = end - start;
  if (ms < 0) {
    // A job that never reached a runner executed for no time and billed
    // nothing -- GitHub meters job EXECUTION. runner_name === null IS the wire
    // saying no runner was ever assigned; such a job gets its timestamps from
    // bookkeeping rather than a runner clock, and they are observed up to a
    // second out of order. Two live examples, both "Dispatch promote (develop,
    // on success)" in CI:
    //   87772384101 conclusion=skipped   started 00:11:45Z completed 00:11:44Z
    //   87196802555 conclusion=cancelled started 20:27:22Z completed 20:27:21Z
    // Keying on conclusion===skipped fixed the first and missed the second
    // (cancel-in-progress kills a job BEFORE dispatch); runner_name is the
    // invariant behind both, so it fixes the CLASS rather than the instances.
    // This is measured absence of work, not absent data -- 0 is honest, and it
    // is not a confident zero. Placed BELOW the null checks and INSIDE the
    // ms<0 branch on purpose: no runner excuses an INVERTED timestamp, never a
    // MISSING one, and a job that DID run still throws on inversion.
    if (job.runner_name === null || job.runner_name === undefined) return 0;
    throw new Error('job ' + String(job.id) + ': completed_at precedes started_at');
  }
  // A skipped job has zero execution time and costs nothing: the round-up must
  // not invent a minute for work that never ran.
  if (ms === 0) return 0;
  return Math.ceil(ms / 60000);
}

/** Group runs by workflow, sum billable minutes, costliest first. */
export function summarizeBillableMinutes(entries: readonly RunEntry[]): BillableReport {
  const acc = new Map<string, { billableMinutes: number; runs: number; jobs: number }>();
  for (const entry of entries) {
    const prev = acc.get(entry.workflowName) ?? { billableMinutes: 0, runs: 0, jobs: 0 };
    let minutes = 0;
    for (const job of entry.jobs) minutes += billableMinutesForJob(job);
    acc.set(entry.workflowName, {
      billableMinutes: prev.billableMinutes + minutes,
      runs: prev.runs + 1,
      jobs: prev.jobs + entry.jobs.length,
    });
  }
  const byWorkflow: WorkflowCost[] = Array.from(acc.entries())
    .map(([workflowName, v]) => ({
      workflowName,
      billableMinutes: v.billableMinutes,
      runs: v.runs,
      jobs: v.jobs,
    }))
    .sort((a, b) => (b.billableMinutes - a.billableMinutes) || a.workflowName.localeCompare(b.workflowName));
  const totalBillableMinutes = byWorkflow.reduce((sum, w) => sum + w.billableMinutes, 0);
  return { totalBillableMinutes, byWorkflow };
}
