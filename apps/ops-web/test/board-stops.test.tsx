// apps/ops-web/test/board-stops.test.tsx
// Unit coverage for the shared board-stop helpers (T10). Exercises the
// status-derivation branches (departed/arrived/none/invalid-date) and the
// slot-resolution branches (pickup, delivery, dropoff alias, empty/undefined).
import { describe, it, expect } from 'vitest';
import { stopStatusOf, stopForSlot } from '@/features/dispatch/board-stops';
import type { DispatchBoardStop } from '@/features/dispatch/types';
function stop(p: Partial<DispatchBoardStop>): DispatchBoardStop {
  return { sequence: 1, stopType: 'pickup', warehouseName: null, arrivedAt: null, departedAt: null, ...p };
}
describe('board-stops - stopStatusOf', () => {
  it('prefers departedAt and formats the time', () => {
    const out = stopStatusOf(stop({ departedAt: '2026-05-30T09:15:00.000Z', arrivedAt: '2026-05-30T09:00:00.000Z' }));
    expect(out).toMatch(/Đã hoàn thành/);
  });
  it('falls back to arrivedAt when not departed', () => {
    const out = stopStatusOf(stop({ arrivedAt: '2026-05-30T09:00:00.000Z' }));
    expect(out).toMatch(/Đã hoàn thành/);
  });
  it('returns Chưa tới when neither timestamp is set', () => {
    expect(stopStatusOf(stop({}))).toBe('Chưa tới');
  });
  it('returns Chưa tới for an unparseable timestamp', () => {
    expect(stopStatusOf(stop({ arrivedAt: 'not-a-date' }))).toBe('Chưa tới');
  });
});
describe('board-stops - stopForSlot', () => {
  const pickups = [stop({ sequence: 2, stopType: 'pickup' }), stop({ sequence: 1, stopType: 'pickup' })];
  it('returns the nth pickup by sequence order', () => {
    expect(stopForSlot(pickups, 'pickup', 1)?.sequence).toBe(1);
    expect(stopForSlot(pickups, 'pickup', 2)?.sequence).toBe(2);
  });
  it('matches delivery and the dropoff alias', () => {
    const drops = [stop({ sequence: 1, stopType: 'delivery' }), stop({ sequence: 2, stopType: 'dropoff' })];
    expect(stopForSlot(drops, 'delivery', 1)?.sequence).toBe(1);
    expect(stopForSlot(drops, 'delivery', 2)?.sequence).toBe(2);
  });
  it('returns undefined for an empty list', () => {
    expect(stopForSlot([], 'pickup', 1)).toBeUndefined();
  });
  it('returns undefined for undefined stops', () => {
    expect(stopForSlot(undefined, 'pickup', 1)).toBeUndefined();
  });
  it('returns undefined when the slot index exceeds available stops', () => {
    expect(stopForSlot(pickups, 'pickup', 5)).toBeUndefined();
  });
});
