// apps/ops-web/test/board-stops-date-only.test.tsx
// outside-in strict TDD RED (t65 Vietnamese-date-format arc): a visited stop's
// status string shows the completion DATE in pure Vietnamese, dd/MM/yyyy.
//
// This spec previously asserted the en-US form (May 31, 2026). The date-only
// intent is preserved; the locale expectation moves to the product language,
// and a UTC+7 boundary case is added because a stop departure recorded in the
// Vietnamese evening is exactly where a host-timezone formatter reports the
// wrong day to the dispatcher.
//
// It also repairs a latent defect in the original assertion: the no-clock regex
// was written /\\d{1,2}:\\d{2}/, which matches a literal backslash followed by
// d, not a digit. It could never fire, so the no-time guarantee was never
// actually tested. The single-backslash form below is the real check.
import { describe, it, expect } from 'vitest';
import { isVnDateString } from '@fleet/sync-protocol';
import { stopStatusOf } from '@/features/dispatch/board-stops';
import type { DispatchBoardStop } from '@/features/dispatch/types';
function stopAt(arrivedAt: string | null, departedAt: string | null): DispatchBoardStop {
  return {
    sequence: 1,
    stopType: 'pickup',
    warehouseName: 'Kho A',
    arrivedAt,
    departedAt,
    proof: null,
  };
}
const DONE_PREFIX = 'Đã hoàn thành ';
describe('stopStatusOf renders a pure Vietnamese completion date', () => {
  it('formats a visited stop as dd/MM/yyyy after the Vietnamese done label', () => {
    const txt = stopStatusOf(stopAt('2026-05-31T11:20:00.000Z', '2026-05-31T12:00:00.000Z'));
    expect(txt).toBe(DONE_PREFIX + '31/05/2026');
  });
  it('never renders an English month abbreviation', () => {
    const txt = stopStatusOf(stopAt('2026-05-31T11:20:00.000Z', '2026-05-31T12:00:00.000Z'));
    expect(txt).not.toContain('May');
  });
  it('stays date-only: no clock component', () => {
    const txt = stopStatusOf(stopAt('2026-05-31T11:20:00.000Z', '2026-05-31T12:00:00.000Z'));
    expect(txt).not.toMatch(/\d{1,2}:\d{2}/);
  });
  it('the date portion satisfies the shared Vietnamese date contract', () => {
    const txt = stopStatusOf(stopAt('2026-05-31T11:20:00.000Z', '2026-05-31T12:00:00.000Z'));
    expect(isVnDateString(txt.slice(DONE_PREFIX.length))).toBe(true);
  });
  it('uses the Asia/Ho_Chi_Minh calendar day for an evening departure', () => {
    // 17:30Z on 31/05 is already 00:30 on 01/06 in Vietnam.
    const txt = stopStatusOf(stopAt('2026-05-31T16:00:00.000Z', '2026-05-31T17:30:00.000Z'));
    expect(txt).toBe(DONE_PREFIX + '01/06/2026');
  });
  it('prefers the departure timestamp over the arrival timestamp', () => {
    const txt = stopStatusOf(stopAt('2026-05-30T02:00:00.000Z', '2026-05-31T02:00:00.000Z'));
    expect(txt).toBe(DONE_PREFIX + '31/05/2026');
  });
  it('falls back to the arrival timestamp when there is no departure', () => {
    const txt = stopStatusOf(stopAt('2026-05-30T02:00:00.000Z', null));
    expect(txt).toBe(DONE_PREFIX + '30/05/2026');
  });
  it('reports Chưa tới when the stop has not been visited', () => {
    expect(stopStatusOf(stopAt(null, null))).toBe('Chưa tới');
  });
});
