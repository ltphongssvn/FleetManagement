// packages/sync-protocol/test/quick-assign-contract.test.ts
// RED-first (Phase 1 -- Phan cong nhanh quick-assign flow).
//
// The quick-assign modal replaces the per-row dropdown + button that repeats
// on every unassigned driver row (pain point #1). The dispatcher picks ONE
// available vehicle and confirms; the client POSTs
// /admin/driver-vehicle-assignments {driverId, vehicleId}. driverId comes from
// the row being assigned, not the form, so the FORM payload is just the chosen
// vehicle.
//
// VEHICLE-ONLY by design. The manual device-UDID pre-enroll path was removed
// at the root (PR #302, T7 self-enroll); the dispatcher only assigns a vehicle,
// device identity is never hand-minted. So there is NO udid and NO platform in
// this contract -- resurrecting them would call a deleted endpoint.
//
// UUID DISCIPLINE (two facets, both honored):
//   * WIRE: vehicleId IS a uuid. The api CreateSchema validates z.guid(), so
//     the submit payload must too or a valid form could still 400.
//   * UI: a raw uuid must NEVER reach the dispatcher (no-raw-UUID-in-UI
//     invariant, f166989). The picker renders the human PLATE (ReferenceItem
//     .label) and carries the uuid only as the option value (ReferenceItem
//     .id); this contract validates that hidden value on submit. The plate
//     lives in the UI layer, never in the wire payload.
import { describe, it, expect } from 'vitest';
import {
  QuickAssignInputSchema,
  parseQuickAssignInput,
  type QuickAssignInput,
} from '../src/quick-assign-contract.js';
const VEHICLE = '11111111-1111-1111-1111-111111111111';
describe('quick-assign submit contract', () => {
  it('parses a valid vehicle uuid', () => {
    const parsed = QuickAssignInputSchema.parse({ vehicleId: VEHICLE });
    expect(parsed.vehicleId).toBe(VEHICLE);
  });
  it('rejects a non-uuid vehicleId (the api CreateSchema would 400)', () => {
    expect(QuickAssignInputSchema.safeParse({ vehicleId: 'v1' }).success).toBe(false);
  });
  it('rejects an empty vehicleId (no vehicle chosen -- the core guard)', () => {
    expect(QuickAssignInputSchema.safeParse({ vehicleId: '' }).success).toBe(false);
  });
  it('rejects a missing vehicleId', () => {
    expect(QuickAssignInputSchema.safeParse({}).success).toBe(false);
  });
  it('has NO udid or platform member (device enrollment was removed)', () => {
    const parsed = QuickAssignInputSchema.parse({ vehicleId: VEHICLE, udid: 'x', platform: 'ios' });
    expect('udid' in parsed).toBe(false);
    expect('platform' in parsed).toBe(false);
  });
  it('parseQuickAssignInput returns the value on success, null on junk (never throws)', () => {
    expect(parseQuickAssignInput({ vehicleId: VEHICLE })?.vehicleId).toBe(VEHICLE);
    expect(parseQuickAssignInput({ vehicleId: 'nope' })).toBeNull();
    expect(parseQuickAssignInput(null)).toBeNull();
    expect(parseQuickAssignInput({})).toBeNull();
  });
  it('narrows to the derived type (compile-time SSOT proof)', () => {
    const input: QuickAssignInput = { vehicleId: VEHICLE };
    expect(input.vehicleId).toBe(VEHICLE);
  });
});
