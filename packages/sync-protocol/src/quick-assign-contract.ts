// packages/sync-protocol/src/quick-assign-contract.ts
// SSOT for the Phan cong nhanh (quick-assign) submit payload.
//
// The quick-assign modal replaces the per-row dropdown + button that repeated
// on every unassigned driver row (pain point #1): the dispatcher picks ONE
// available vehicle and confirms, and the client POSTs
// /admin/driver-vehicle-assignments {driverId, vehicleId}. driverId is supplied
// by the row being assigned, so the FORM payload validated here is just the
// chosen vehicle.
//
// VEHICLE-ONLY by design. The manual device-UDID pre-enroll path was removed at
// the root (PR #302, superseded by T7 self-enroll); the dispatcher only assigns
// a vehicle, device identity is never hand-minted. No udid, no platform.
//
// UUID discipline, both facets:
//   * WIRE -- vehicleId IS a uuid: the api CreateSchema validates z.guid(), so
//     this must too, or a valid form could still 400.
//   * UI -- a raw uuid must never reach the dispatcher (no-raw-UUID-in-UI
//     invariant): the picker renders the human plate (ReferenceItem.label) and
//     carries the uuid only as the option value (ReferenceItem.id). This schema
//     validates that hidden value on submit; the plate never enters the wire.
import { z } from 'zod';
export const QuickAssignInputSchema = z.object({
  vehicleId: z.guid(),
});
export type QuickAssignInput = z.infer<typeof QuickAssignInputSchema>;
// Safe boundary parse: the chosen value or null, never a throw. The modal calls
// this on submit; null means no valid vehicle was chosen and the confirm stays
// disabled / the call is not made.
export function parseQuickAssignInput(raw: unknown): QuickAssignInput | null {
  const parsed = QuickAssignInputSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
