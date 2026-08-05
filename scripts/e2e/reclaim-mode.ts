// scripts/e2e/reclaim-mode.ts
// Pure argv parsing and report formatting for docker:reclaim --report.
// No child_process, no docker: callers gather classifications and pass them in.
//
// WHY A FLAG AND NOT A NEW TASK. docker:reclaim already discovers every running
// fleet project. A second task would re-derive that list and could disagree
// with the first -- two answers to one question, which is the duplication this
// codebase keeps removing. Age is a new DIMENSION of the same reading.
//
// WHY ADDITIVE, NEVER A CHANGE OF DEFAULT. The default stays stop-everything so
// every existing invocation keeps its meaning. A flag that silently converted a
// reclaim into a survey would be the worst regression available here: the
// operator would believe the host was freed while containers held RAM -- the
// precise failure stack:stop shipped once, printing STACK STOPPED and exiting 0
// while seven containers stayed resident for two days.
//
// POLARITY IS DELIBERATELY INVERTED vs deps:reconcile. There, WRITING needed
// opt-in because writing was the dangerous act. Here, READING is the opt-in,
// because the existing default already acts and changing that is the danger.
import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { StackAge, StackAgeSummary } from './stack-age.js';
// Axis-1 trust boundary: process.argv is external input. parseArgs gives
// structure; the schema gives the guarantee. A ttl of zero or less would mark
// every stack idle and turn the report into noise, so it is rejected here
// rather than defaulted away.
export const reclaimArgvSchema = z.object({
  report: z.boolean(),
  ttlHours: z.number().positive(),
});
export type ReclaimArgv = z.infer<typeof reclaimArgvSchema>;
const DEFAULT_TTL_HOURS = 2;
export function parseReclaimArgv(argv: readonly string[]): ReclaimArgv {
  // strict is the DEFAULT: an unknown flag THROWS. That matters more here than
  // anywhere else in this file -- a swallowed --report typo would STOP every
  // stack the operator meant only to inspect.
  const { values } = parseArgs({
    args: [...argv],
    options: {
      report: { type: 'boolean', default: false },
      'ttl-hours': { type: 'string' },
    },
    allowPositionals: false,
    strict: true,
  });
  const raw = values['ttl-hours'];
  // Number('') is 0 and Number('soon') is NaN; both must fail rather than
  // silently becoming a default, so the schema sees the parsed value.
  const ttlHours = raw === undefined ? DEFAULT_TTL_HOURS : Number(raw);
  return reclaimArgvSchema.parse({ report: values.report, ttlHours });
}
export function summarizeStackAges(ages: readonly StackAge[]): StackAgeSummary {
  const summary: StackAgeSummary = { fresh: 0, idle: 0, stale: 0 };
  for (const a of ages) {
    if (a.kind === 'fresh') summary.fresh += 1;
    else if (a.kind === 'idle') summary.idle += 1;
    else summary.stale += 1;
  }
  return summary;
}
const REMEDY = 'run: turbo run docker:reclaim';
function hours(n: number): string {
  return n.toFixed(1) + 'h';
}
// One line per project. Non-fresh lines carry the AGE and the REMEDY, because a
// bare IDLE label makes the operator run another command to learn how bad it is
// and a third to learn what to do -- which is how a report becomes something
// people stop reading.
export function formatAgeReport(ages: readonly StackAge[]): readonly string[] {
  return ages.map((a) => {
    if (a.kind === 'fresh') return 'fresh   ' + a.project;
    if (a.kind === 'idle') {
      return 'IDLE    ' + a.project + ' (' + hours(a.ageHours) + ' -- ' + REMEDY + ')';
    }
    return 'STALE   ' + a.project + ' (' + hours(a.ageHours) + ' -- ' + REMEDY + ')';
  });
}
