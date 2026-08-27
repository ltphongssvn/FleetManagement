// packages/sync-protocol/src/dispatch-roster-split-contract.ts
// SSOT wire contract for the Bang dieu phoi xe dispatched-vs-idle driver split:
// two side-by-side tables the owner reads at a glance - who is on the road
// today, and who stays home with an idle truck.
//
// WHY A REASON ON EVERY IDLE ROW. 2026 fleet-utilization practice separates a
// unit that is AVAILABLE BUT IDLE (a dispatch / app-adoption problem the owner
// acts on) from one that CANNOT be dispatched (no active vehicle - an
// assignment problem). A bare name list would not tell the owner whether to
// push in-app dispatch or fix a binding, so reason is REQUIRED, not optional.
//   no_dispatch_today   -> has an active vehicle, no road run today. This is
//                          the row the owner questions: often the dispatcher
//                          still sent the job over Zalo, so it never entered
//                          the app.
//   no_vehicle_assigned -> no active driver_vehicle_assignment, so the driver
//                          could not be dispatched even in principle.
//
// THE PARTITION IS THE LOAD-BEARING RULE. dispatched + idle must cover the
// whole active roster exactly: no driver in both columns, none dropped. A
// silently dropped driver is worse than a wrong count, because the owner
// cannot see the omission. isRosterPartitionValid is the SSOT predicate, so
// the API service test, the ops-web panel test and the E2E flow all assert
// ONE definition of correctness rather than three re-implementations.
//
// Read-path contract => strip mode (z.object) + a lenient parse helper that
// returns null and never throws, per context/schema-first-zod-contracts.md.
// .describe() on every field doubles as the human/LLM-facing spec.
import { z } from 'zod';

// Road-run lifecycle vocabulary. SSOT is @fleet/domain RoadRunStateSchema;
// inlined here (NOT imported) so this contract package stays dependency-free
// (zod only), matching dispatch-stop-view-contract.ts. Kept in lockstep by the
// contract tests.
const ROAD_RUN_STATES = ['planned', 'dispatched', 'started', 'completed', 'cancelled'] as const;

/** SSOT idle-reason vocabulary. Ordered most-actionable first. */
export const IDLE_REASONS = ['no_dispatch_today', 'no_vehicle_assigned'] as const;
export type IdleReason = (typeof IDLE_REASONS)[number];
export const IdleReasonSchema = z.enum(IDLE_REASONS);

/** YYYY-MM-DD Asia/Ho_Chi_Minh calendar key. */
const DayKeySchema = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
  .describe('The Asia/Ho_Chi_Minh calendar day this split covers, YYYY-MM-DD');

/** One driver ON THE ROAD today (left table). */
export const DispatchedDriverRowSchema = z.object({
  driverId: z.guid().describe('driver.driver_id'),
  driverName: z.string().describe('Driver full name as shown to the owner'),
  vehiclePlate: z
    .union([z.string(), z.null()])
    .describe('Plate of the vehicle on the run; null when the run carries no asset'),
  roadRunId: z.guid().describe('The road run that put this driver on the road today'),
  state: z.enum(ROAD_RUN_STATES).describe('Road-run lifecycle state of that run'),
  plannedStartAt: z
    .union([z.string(), z.null()])
    .describe('ISO-8601 planned start instant of the run, or null'),
  orderRefs: z.array(z.string()).readonly().describe('Transport order refs on the run'),
});
export type DispatchedDriverRow = z.infer<typeof DispatchedDriverRowSchema>;

/** One driver STAYING HOME today (right table). */
export const IdleDriverRowSchema = z.object({
  driverId: z.guid().describe('driver.driver_id'),
  driverName: z.string().describe('Driver full name as shown to the owner'),
  vehiclePlate: z
    .union([z.string(), z.null()])
    .describe('Plate of the idle truck; null when no active assignment exists'),
  reason: IdleReasonSchema.describe('Why this driver is not on the road today'),
});
export type IdleDriverRow = z.infer<typeof IdleDriverRowSchema>;

/** Full GET /dispatch/roster-split response envelope. */
export const DispatchRosterSplitSchema = z.object({
  day: DayKeySchema,
  asOf: z.iso.datetime().describe('Server capture instant, ISO-8601 UTC'),
  totalDrivers: z
    .number()
    .int()
    .min(0)
    .describe('Active roster size (driver.active = true) - the partition denominator'),
  dispatched: z.array(DispatchedDriverRowSchema).readonly(),
  idle: z.array(IdleDriverRowSchema).readonly(),
});
export type DispatchRosterSplit = z.infer<typeof DispatchRosterSplitSchema>;

/** Lenient boundary parse for read paths: null on any mismatch, never throw. */
export function parseDispatchRosterSplit(raw: unknown): DispatchRosterSplit | null {
  const parsed = DispatchRosterSplitSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * SSOT partition predicate. True only when the two columns partition the
 * active roster EXACTLY:
 *   1. no driver appears in both columns, and none is repeated within one
 *   2. dispatched + idle equals totalDrivers
 * A driver missing from both columns fails rule 2; a driver in both fails
 * rule 1. One definition, asserted identically by the API, the panel and E2E.
 */
export function isRosterPartitionValid(split: DispatchRosterSplit): boolean {
  const ids = new Set<string>();
  for (const row of split.dispatched) ids.add(row.driverId);
  for (const row of split.idle) ids.add(row.driverId);
  const listed = split.dispatched.length + split.idle.length;
  if (ids.size !== listed) return false;
  return listed === split.totalDrivers;
}
