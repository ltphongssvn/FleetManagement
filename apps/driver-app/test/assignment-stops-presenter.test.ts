// apps/driver-app/test/assignment-stops-presenter.test.ts
// outside-in strict TDD RED (L1 presenter): the driver assignments card must
// render EVERY stop the Lệnh điều xe - Tải thùng form created, in sequence —
// not a collapsed pickup/delivery pair. Pure presenter (no native deps),
// mirroring capture-screen-presenter. Vietnamese UI is immutable.
//
// Each stop row must also carry the capture-route descriptor (stopKind +
// stopIndex) so the assignment card can deep-link to the per-warehouse proof
// screen (/capture?stopKind=loading&stopIndex=0..3 | stopKind=unloading).
// pickup -> loading with a 0-based stopIndex (matching displayIndex-1);
// delivery -> unloading with stopIndex null (single unloading warehouse).
//
// STOPS ARE BUILT THROUGH THE FIXTURE FACTORY, NEVER AS OBJECT LITERALS.
// This file previously hand-wrote twelve StopRow literals. When this arc added
// proof to ListAssignedRowStopSchema — importing the canonical StopProofSchema
// so the review surface and the board surface cannot drift — every one of those
// literals stopped compiling, and the branch sat red for three weeks over a
// field no test here cares about.
//
// The mechanism is Zod's input/output asymmetry: proof is .default(null), so it
// is OPTIONAL on input and REQUIRED on output. z.infer yields the OUTPUT type,
// so a literal annotated StopRow must supply it even though .parse() would fill
// it in. createListAssignedStop parses the schema, so the default applies and
// the fixture is valid by construction.
//
// 2026 practice, and the reason this is the fix rather than adding proof: null
// twelve times: use a factory for all entity creation, never inline literals,
// because a factory centralises the change when the contract evolves. Adding
// the field by hand would leave the next contract field to break all twelve
// again.
import { describe, it, expect } from 'vitest';
import { createListAssignedStop } from '@fleet/test-fixtures';
import { presentAssignmentStops } from '../src/assignments/assignment-stops-presenter.js';
import type { StopRow } from '../src/assignments/assignments-client.js';
const stops: readonly StopRow[] = [
  createListAssignedStop({ sequence: 1, stopType: 'pickup', plannedAt: '2026-05-10T08:00:00Z', warehouseName: 'Kho nhận 1' }),
  createListAssignedStop({ sequence: 2, stopType: 'pickup', plannedAt: '2026-05-10T09:00:00Z', warehouseName: 'Kho nhận 2' }),
  createListAssignedStop({ sequence: 3, stopType: 'pickup', plannedAt: null, warehouseName: 'Kho nhận 3' }),
  createListAssignedStop({ sequence: 4, stopType: 'delivery', plannedAt: '2026-05-10T14:00:00Z', warehouseName: 'Kho giao' }),
];
describe('presentAssignmentStops (multi-stop parity)', () => {
  it('produces one row per stop in sequence order', () => {
    const vm = presentAssignmentStops(stops);
    expect(vm).toHaveLength(4);
    expect(vm.map((r) => r.key)).toEqual(['stop-1', 'stop-2', 'stop-3', 'stop-4']);
  });
  it('labels pickup stops with a 1-based index, delivery without index', () => {
    const vm = presentAssignmentStops(stops);
    expect(vm[0]?.label).toBe('Kho nhận hàng 1');
    expect(vm[1]?.label).toBe('Kho nhận hàng 2');
    expect(vm[2]?.label).toBe('Kho nhận hàng 3');
    expect(vm[3]?.label).toBe('Kho giao hàng');
  });
  it('shows the warehouse name, falling back to a placeholder when null', () => {
    const vm = presentAssignmentStops([
      createListAssignedStop({ sequence: 1, stopType: 'pickup', plannedAt: null, warehouseName: null }),
    ]);
    expect(vm[0]?.warehouseName).toBe('— Chưa có kho —');
  });
  it('marks a stop completed when departedAt is set', () => {
    const vm = presentAssignmentStops([
      createListAssignedStop({
        sequence: 1, stopType: 'pickup', plannedAt: null, warehouseName: 'Kho A',
        arrivedAt: '2026-05-10T08:30:00Z', departedAt: '2026-05-10T08:45:00Z',
      }),
    ]);
    expect(vm[0]?.done).toBe(true);
  });
  it('marks a stop not-done when departedAt is null', () => {
    const vm = presentAssignmentStops(stops);
    expect(vm[0]?.done).toBe(false);
  });
  it('numbers pickups independently of delivery interleaving', () => {
    const interleaved: readonly StopRow[] = [
      createListAssignedStop({ sequence: 1, stopType: 'pickup', plannedAt: null, warehouseName: 'P1' }),
      createListAssignedStop({ sequence: 2, stopType: 'delivery', plannedAt: null, warehouseName: 'D1' }),
      createListAssignedStop({ sequence: 3, stopType: 'pickup', plannedAt: null, warehouseName: 'P2' }),
    ];
    const vm = presentAssignmentStops(interleaved);
    expect(vm.map((r) => r.label)).toEqual(['Kho nhận hàng 1', 'Kho giao hàng', 'Kho nhận hàng 2']);
  });
  it('returns empty for no stops', () => {
    expect(presentAssignmentStops([])).toEqual([]);
  });
  it('exposes capture descriptor: pickup -> loading with 0-based stopIndex', () => {
    const vm = presentAssignmentStops(stops);
    expect(vm[0]?.stopKind).toBe('loading');
    expect(vm[0]?.stopIndex).toBe(0);
    expect(vm[1]?.stopKind).toBe('loading');
    expect(vm[1]?.stopIndex).toBe(1);
    expect(vm[2]?.stopKind).toBe('loading');
    expect(vm[2]?.stopIndex).toBe(2);
  });
  it('exposes capture descriptor: delivery -> unloading with null stopIndex', () => {
    const vm = presentAssignmentStops(stops);
    expect(vm[3]?.stopKind).toBe('unloading');
    expect(vm[3]?.stopIndex).toBeNull();
  });
  it('keeps loading stopIndex aligned to pickup order under interleaving', () => {
    const interleaved: readonly StopRow[] = [
      createListAssignedStop({ sequence: 1, stopType: 'pickup', plannedAt: null, warehouseName: 'P1' }),
      createListAssignedStop({ sequence: 2, stopType: 'delivery', plannedAt: null, warehouseName: 'D1' }),
      createListAssignedStop({ sequence: 3, stopType: 'pickup', plannedAt: null, warehouseName: 'P2' }),
    ];
    const vm = presentAssignmentStops(interleaved);
    expect(vm[0]?.stopKind).toBe('loading');
    expect(vm[0]?.stopIndex).toBe(0);
    expect(vm[1]?.stopKind).toBe('unloading');
    expect(vm[1]?.stopIndex).toBeNull();
    expect(vm[2]?.stopKind).toBe('loading');
    expect(vm[2]?.stopIndex).toBe(1);
  });
});
