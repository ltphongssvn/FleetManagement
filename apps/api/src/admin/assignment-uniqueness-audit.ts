// apps/api/src/admin/assignment-uniqueness-audit.ts
// Pure classifier for the driver-vehicle assignment-pair uniqueness audit.
// Zero DB access: takes already-fetched ACTIVE (revoked_at IS NULL)
// assignment rows and detects violations of the 1:1 invariant the schema
// declares via two partial-unique indexes:
//   dva_one_active_per_driver_uq  on (company_id, driver_id)  WHERE revoked_at IS NULL
//   dva_one_active_per_vehicle_uq on (company_id, vehicle_id) WHERE revoked_at IS NULL
// A correctly-enforced prod DB can produce ZERO violations here; any group
// means the index is missing/invalid or a raw path bypassed it (T9 class).
// Schema-first: AssignmentAuditRowSchema is the trust-boundary contract; the
// report type is z.infer-derived (two-axis SSOT).
import { z } from 'zod';

export const AssignmentAuditRowSchema = z.object({
  assignmentId: z.uuid(),
  companyId: z.uuid(),
  driverId: z.uuid(),
  vehicleId: z.uuid(),
});
export type AssignmentAuditRow = z.infer<typeof AssignmentAuditRowSchema>;

export const AssignmentAuditReportSchema = z.object({
  totalActiveAssignments: z.number().int().nonnegative(),
  duplicateDriverGroups: z.array(
    z.object({
      companyId: z.uuid(),
      driverId: z.uuid(),
      assignmentIds: z.array(z.uuid()).min(2),
    }),
  ),
  duplicateVehicleGroups: z.array(
    z.object({
      companyId: z.uuid(),
      vehicleId: z.uuid(),
      assignmentIds: z.array(z.uuid()).min(2),
    }),
  ),
  duplicatePairGroups: z.array(
    z.object({
      companyId: z.uuid(),
      driverId: z.uuid(),
      vehicleId: z.uuid(),
      assignmentIds: z.array(z.uuid()).min(2),
    }),
  ),
  isClean: z.boolean(),
});
export type AssignmentAuditReport = z.infer<typeof AssignmentAuditReportSchema>;

function groupBy(
  rows: readonly AssignmentAuditRow[],
  keyFn: (r: AssignmentAuditRow) => string,
): Map<string, AssignmentAuditRow[]> {
  const m = new Map<string, AssignmentAuditRow[]>();
  for (const r of rows) {
    const k = keyFn(r);
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  return m;
}

const SEP = '::';

export function auditAssignmentUniqueness(rowsInput: readonly unknown[]): AssignmentAuditReport {
  const rows: AssignmentAuditRow[] = rowsInput.map((r) => AssignmentAuditRowSchema.parse(r));

  const byDriver = groupBy(rows, (r) => r.companyId + SEP + r.driverId);
  const duplicateDriverGroups = [...byDriver.values()]
    .filter((g) => g.length >= 2)
    .flatMap((g) => {
      const first = g[0];
      /* c8 ignore next -- filtered g.length >= 2 guarantees a first element */
      if (first === undefined) return [];
      return [
        {
          companyId: first.companyId,
          driverId: first.driverId,
          assignmentIds: g.map((r) => r.assignmentId),
        },
      ];
    });

  const byVehicle = groupBy(rows, (r) => r.companyId + SEP + r.vehicleId);
  const duplicateVehicleGroups = [...byVehicle.values()]
    .filter((g) => g.length >= 2)
    .flatMap((g) => {
      const first = g[0];
      /* c8 ignore next -- filtered g.length >= 2 guarantees a first element */
      if (first === undefined) return [];
      return [
        {
          companyId: first.companyId,
          vehicleId: first.vehicleId,
          assignmentIds: g.map((r) => r.assignmentId),
        },
      ];
    });

  const byPair = groupBy(rows, (r) => r.companyId + SEP + r.driverId + SEP + r.vehicleId);
  const duplicatePairGroups = [...byPair.values()]
    .filter((g) => g.length >= 2)
    .flatMap((g) => {
      const first = g[0];
      /* c8 ignore next -- filtered g.length >= 2 guarantees a first element */
      if (first === undefined) return [];
      return [
        {
          companyId: first.companyId,
          driverId: first.driverId,
          vehicleId: first.vehicleId,
          assignmentIds: g.map((r) => r.assignmentId),
        },
      ];
    });

  const isClean =
    duplicateDriverGroups.length === 0 &&
    duplicateVehicleGroups.length === 0 &&
    duplicatePairGroups.length === 0;

  return {
    totalActiveAssignments: rows.length,
    duplicateDriverGroups,
    duplicateVehicleGroups,
    duplicatePairGroups,
    isClean,
  };
}
