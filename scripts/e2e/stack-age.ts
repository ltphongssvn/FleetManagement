// scripts/e2e/stack-age.ts
// Pure age classification for RUNNING fleet compose stacks. No child_process,
// no docker. Callers gather timestamps and pass them in; this module only
// decides -- the same core/shell split docker-reclaim.ts uses.
//
// WHY THIS EXISTS. docker:reclaim can stop idle stacks, but nothing made an
// idle stack VISIBLE. Seven containers ran for hours at 46% CPU (localstack
// polling s3.ListBuckets every six seconds) and were found only because a
// human screenshotted Docker Desktop. A reclaim tool nobody knows to run is
// not a control; a report you can run in one second is.
//
// WHY AGE AND NOT PROCESS LIFETIME. The 2026 pattern for ephemeral test stacks
// is a reaper bound to the spawning process, which tears the stack down even on
// abnormal exit. That model does not fit stack:up, which is DELIBERATELY
// long-lived -- held open for manual browser verification -- so binding its
// lifetime to the spawner would destroy its purpose. Reaping RUNNING containers
// by max age is the recognised separate concept. Of its enumerated
// implementations (host script, docker events subscription, or baking it into
// the app that spawns them) this is the third: the spawner is already a
// registered TypeScript task, so no sidecar, no privileged container, no daemon.
//
// WHY docker inspect .State.StartedAt.
//   - compose/ps CreatedAt emits "2026-08-05 06:02:26 +0000 UTC", which Date
//     cannot parse reliably. A known unfixed docker/compose defect (#12520,
//     which proposes reformatting it as RFC3339Nano).
//   - RunningFor emits human prose ("2 hours ago"), the message-matching
//     treadmill this codebase has already removed twice.
//   - StartedAt rather than CreatedAt because a RESTARTED container has a fresh
//     working life; creation time does not reflect how long it has held RAM.
//
// NANOSECONDS, NOT MILLISECONDS. Docker emits RFC3339Nano with nine fractional
// digits (2021-05-07T17:27:52.347500403Z) and podman the same precision with a
// numeric offset (2021-05-07T13:28:21.783776413-04:00). A schema pinned to
// three digits and a Z would reject genuine output and classify every stack
// fresh -- a confident zero produced by the measurement rather than the thing
// measured.
import { z } from 'zod';
const NL = String.fromCharCode(10);
const MS_PER_HOUR = 3_600_000;
// STALE is four TTLs: long enough that a genuinely extended session is only
// "idle", short enough that an overnight leak reads differently in the report.
const STALE_MULTIPLE = 4;
// Axis-1 trust boundary: docker stdout is external input. Anchored, tolerant of
// 0-9 fractional digits, and accepts Z or a numeric offset. refine() rejects
// anything Date cannot actually parse, so a shape that passes the regex but
// yields NaN still fails closed.
export const startedAtSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/)
  .refine((s) => !Number.isNaN(Date.parse(s)), { message: 'unparseable timestamp' });
/** Earliest StartedAt across a project's containers: a stack is as old as its
 *  oldest container. Throws on a malformed line -- silently skipping one would
 *  understate the stack's age, which is the failure that hides a leak. */
export function oldestStartedAt(stdout: string): string | null {
  const lines = stdout
    .split(NL)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const parsed = lines.map((l) => startedAtSchema.parse(l));
  let oldest = parsed[0] ?? null;
  if (oldest === null) return null;
  for (const ts of parsed) {
    if (Date.parse(ts) < Date.parse(oldest)) oldest = ts;
  }
  return oldest;
}
export interface StackAgeInput {
  project: string;
  startedAt: string | null;
  now: Date;
  ttlHours: number;
}
export type StackAge =
  | { kind: 'fresh'; project: string }
  | { kind: 'idle'; project: string; ageHours: number }
  | { kind: 'stale'; project: string; ageHours: number };
// A non-positive TTL would classify every stack idle, turning the report into
// noise the operator learns to ignore -- so it throws rather than degrading.
export function classifyStackAge(input: StackAgeInput): StackAge {
  if (!(input.ttlHours > 0)) {
    throw new Error('ttlHours must be positive, got: ' + String(input.ttlHours));
  }
  if (input.startedAt === null) return { kind: 'fresh', project: input.project };
  const ageHours = (input.now.getTime() - Date.parse(input.startedAt)) / MS_PER_HOUR;
  // The boundary belongs to fresh: a session that runs exactly to the limit is
  // not nagged.
  if (ageHours <= input.ttlHours) return { kind: 'fresh', project: input.project };
  if (ageHours > input.ttlHours * STALE_MULTIPLE) {
    return { kind: 'stale', project: input.project, ageHours };
  }
  return { kind: 'idle', project: input.project, ageHours };
}
/** Container ids for one compose project, selected by the LABEL compose sets.
 *  Names are deliberately never parsed: hyphenated services (ops-web,
 *  mock-oauth2, driver-app) break every split, a failure already pinned by
 *  docker-reclaim's tests. */
export function psIdsArgsForProject(project: string): readonly string[] {
  return [
    'ps',
    '--filter',
    'label=com.docker.compose.project=' + project,
    '--format',
    '{{.ID}}',
  ];
}
/** StartedAt for each id, one per line, in RFC3339Nano. */
export function inspectStartedAtArgs(ids: readonly string[]): readonly string[] {
  return ['inspect', '--format', '{{.State.StartedAt}}', ...ids];
}
// Graded, matching the house convention. 2 stays RESERVED for usage. STALE
// dominates IDLE because an overnight leak and a long session need different
// responses, and the worse one must not be masked by the milder count.
export const STACK_AGE_EXIT = {
  ok: 0,
  idle: 1,
  usage: 2,
  stale: 3,
} as const;
export interface StackAgeSummary {
  fresh: number;
  idle: number;
  stale: number;
}
export function stackAgeExitCode(s: StackAgeSummary): number {
  if (s.stale > 0) return STACK_AGE_EXIT.stale;
  if (s.idle > 0) return STACK_AGE_EXIT.idle;
  return STACK_AGE_EXIT.ok;
}
