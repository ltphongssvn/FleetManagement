// apps/driver-app/test/assignment-stops-presenter.test.ts
// outside-in strict TDD RED (L1 presenter): the driver assignments card must
// render EVERY stop the Lệnh điều xe - Tải thùng form created, in sequence —
// not a collapsed pickup/delivery pair. Pure presenter (no native deps),
// mirroring capture-screen-presenter. Vietnamese UI is immutable.
import { describe, it, expect } from 'vitest';
import { presentAssignmentStops } from '../src/assignments/assignment-stops-presenter.js';
import type { StopRow } from '../src/assignments/assignments-client.js';
const stops: readonly StopRow[] = [
  { sequence: 1, stopType: 'pickup', plannedAt: '2026-05-10T08:00:00Z', warehouseName: 'Kho nhận 1', arrivedAt: null, departedAt: null },
  { sequence: 2, stopType: 'pickup', plannedAt: '2026-05-10T09:00:00Z', warehouseName: 'Kho nhận 2', arrivedAt: null, departedAt: null },
  { sequence: 3, stopType: 'pickup', plannedAt: null, warehouseName: 'Kho nhận 3', arrivedAt: null, departedAt: null },
  { sequence: 4, stopType: 'delivery', plannedAt: '2026-05-10T14:00:00Z', warehouseName: 'Kho giao', arrivedAt: null, departedAt: null },
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
    const vm = presentAssignmentStops([{ sequence: 1, stopType: 'pickup', plannedAt: null, warehouseName: null, arrivedAt: null, departedAt: null }]);
    expect(vm[0]?.warehouseName).toBe('— Chưa có kho —');
  });
  it('marks a stop completed when departedAt is set', () => {
    const vm = presentAssignmentStops([{ sequence: 1, stopType: 'pickup', plannedAt: null, warehouseName: 'Kho A', arrivedAt: '2026-05-10T08:30:00Z', departedAt: '2026-05-10T08:45:00Z' }]);
    expect(vm[0]?.done).toBe(true);
  });
  it('marks a stop not-done when departedAt is null', () => {
    const vm = presentAssignmentStops(stops);
    expect(vm[0]?.done).toBe(false);
  });
  it('numbers pickups independently of delivery interleaving', () => {
    const interleaved: readonly StopRow[] = [
      { sequence: 1, stopType: 'pickup', plannedAt: null, warehouseName: 'P1', arrivedAt: null, departedAt: null },
      { sequence: 2, stopType: 'delivery', plannedAt: null, warehouseName: 'D1', arrivedAt: null, departedAt: null },
      { sequence: 3, stopType: 'pickup', plannedAt: null, warehouseName: 'P2', arrivedAt: null, departedAt: null },
    ];
    const vm = presentAssignmentStops(interleaved);
    expect(vm.map((r) => r.label)).toEqual(['Kho nhận hàng 1', 'Kho giao hàng', 'Kho nhận hàng 2']);
  });
  it('returns empty for no stops', () => {
    expect(presentAssignmentStops([])).toEqual([]);
  });
});
