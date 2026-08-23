// packages/sync-protocol/src/driver-attention-contract.ts
// SSOT for the /admin/drivers wire row + driver-attention classification.
// Two-axis rule: AXIS 2 -- this schema is the single shape definition for
// the admin driver row; ops-web DriverRow/DeviceInfo/VehicleInfo become
// z.infer re-exports of it (no hand-written duplicates). AXIS 1 --
// parseAdminDriverRows validates ONCE at the HTTP trust boundary (replacing
// the bare res.json() as-cast in admin-drivers-client.list); everything
// downstream is trusted and never re-validated. Classification is pure over
// trusted rows and emits machine-readable reason codes; UIs map codes to
// immutable Vietnamese copy in presenters (Chua giao / Chua dang ky stay in
// the UI layer) -- the same two-tier discipline as FleetErrorCode.
// looseObject keeps unknown wire members so a newer producer never breaks an
// older consumer; the boundary parse is safe (null, never throw) so junk
// degrades to a handled load error, not a crash.
import { z } from 'zod';

/** Strict producer union: every reason the classifier may emit today. */
export const DRIVER_ATTENTION_REASONS = ['VEHICLE_UNASSIGNED', 'DEVICE_UNREGISTERED'] as const;

export const DriverAttentionReasonSchema = z.enum(DRIVER_ATTENTION_REASONS);
export type DriverAttentionReason = z.infer<typeof DriverAttentionReasonSchema>;

/** Device as serialized by GET /admin/drivers. */
export const AdminDriverDeviceSchema = z.looseObject({
  deviceId: z.string(),
  platform: z.string(),
  appVersion: z.string(),
  lastSeenAt: z.string().nullable(),
});
export type AdminDriverDevice = z.infer<typeof AdminDriverDeviceSchema>;

/** Assigned vehicle as serialized by GET /admin/drivers. */
export const AdminDriverVehicleSchema = z.looseObject({
  vehicleId: z.string(),
  plate: z.string(),
});
export type AdminDriverVehicle = z.infer<typeof AdminDriverVehicleSchema>;

/** One admin driver row -- the wire truth of GET /admin/drivers. */
export const AdminDriverRowSchema = z.looseObject({
  driverId: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  operatorId: z.string().nullable(),
  assignedVehicle: AdminDriverVehicleSchema.nullable(),
  assignmentId: z.string().nullable(),
  devices: z.array(AdminDriverDeviceSchema),
});
export type AdminDriverRow = z.infer<typeof AdminDriverRowSchema>;

export const AdminDriverRowsSchema = z.array(AdminDriverRowSchema);

/** Safe trust-boundary parse: rows or null, never a throw. */
export function parseAdminDriverRows(raw: unknown): readonly AdminDriverRow[] | null {
  const parsed = AdminDriverRowsSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * Structural facts the classifier needs; AdminDriverRow-compatible by shape.
 * Internal, non-duplicated param type -- plain TS by the two-axis rule.
 */
export interface DriverAttentionFacts {
  readonly assignedVehicle?: unknown;
  readonly devices: readonly unknown[];
}

/**
 * Pure classification over trusted rows: reasons in stable declaration order
 * (vehicle axis first, then device axis). Empty array = fully set up.
 */
export function classifyDriverAttention(
  facts: DriverAttentionFacts,
): readonly DriverAttentionReason[] {
  const reasons: DriverAttentionReason[] = [];
  if (facts.assignedVehicle === null || facts.assignedVehicle === undefined) {
    reasons.push('VEHICLE_UNASSIGNED');
  }
  if (facts.devices.length === 0) {
    reasons.push('DEVICE_UNREGISTERED');
  }
  return reasons;
}

/** True when at least one attention reason applies. */
export function needsDriverAttention(facts: DriverAttentionFacts): boolean {
  return classifyDriverAttention(facts).length > 0;
}
