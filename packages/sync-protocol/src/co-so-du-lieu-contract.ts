// packages/sync-protocol/src/co-so-du-lieu-contract.ts
// SSOT for the Cơ sở dữ liệu consolidated-page driver status badge. Collapses
// the two independent AdminDriverRow attention axes (vehicle assignment +
// device liveness) into ONE ordered three-state badge the merged table renders:
// unassigned -> assigned -> active. Two-axis rule: AXIS 2 -- this enum + z.infer
// type are the single definition; ops-web derives its badge type from here,
// never a hand-written duplicate. Codes only (contract); the Vietnamese labels
// (Chưa phân công / Đã giao xe / Đang hoạt động) live in the ops-web presenter,
// the same two-tier discipline as driver-attention-contract. The classifier is
// pure over trusted rows; liveness reuses the admin UDID pre-enroll placeholder
// appVersion 0.0.0 (a real running app self-enrolls with a real version).
import { z } from 'zod';

// Ordered, frozen three-state tuple (badge display order). Object.freeze so no
// caller can mutate the shared SSOT array; z.enum + z.infer derive from it.
export const DRIVER_DB_STATUSES = Object.freeze([
  'unassigned',
  'assigned',
  'active',
] as const);
export const driverDbStatusSchema = z.enum(DRIVER_DB_STATUSES);
export type DriverDbStatus = z.infer<typeof driverDbStatusSchema>;

// The admin UDID pre-enroll placeholder version. A device still carrying it has
// never run the real app, so it does not count toward the active state.
export const DRIVER_DB_STATUS_PLACEHOLDER_APP_VERSION = '0.0.0';

// Structural facts the classifier reads; AdminDriverRow-compatible by shape
// (its required members satisfy these). Internal, non-duplicated param type --
// plain TS by the two-axis rule (no runtime schema for an internal shape).
export interface DriverDbStatusFacts {
  readonly assignedVehicle?: unknown;
  readonly devices: readonly { readonly appVersion: string }[];
}

// Pure three-state collapse over a trusted row. No vehicle -> unassigned; a
// vehicle with at least one device on a real (non-placeholder) app version ->
// active; otherwise (vehicle but only placeholder or no devices) -> assigned.
export function classifyDriverDbStatus(facts: DriverDbStatusFacts): DriverDbStatus {
  if (facts.assignedVehicle === null || facts.assignedVehicle === undefined) {
    return 'unassigned';
  }
  const hasLiveDevice = facts.devices.some(
    (d) => d.appVersion !== DRIVER_DB_STATUS_PLACEHOLDER_APP_VERSION,
  );
  return hasLiveDevice ? 'active' : 'assigned';
}
