// apps/ops-web/test/board-stops-date-only.test.tsx
// outside-in strict TDD RED (L0): a visited stop's status string shows the
// completion DATE only (no time), consistent with the app-wide date-only
// invariant. Underlying arrived/departed timestamps are unchanged.
import { describe, it, expect } from 'vitest';
import { stopStatusOf } from '@/features/dispatch/board-stops';
import type { DispatchBoardStop } from '@/features/dispatch/types';
describe('stopStatusOf date-only', () => {
  it('formats a visited stop with date only (no time component)', () => {
    const stop: DispatchBoardStop = {
      sequence: 1,
      stopType: 'pickup',
      warehouseName: 'Kho A',
      arrivedAt: '2026-05-31T11:20:00.000Z',
      departedAt: '2026-05-31T12:00:00.000Z',
      proof: null,
    };
    const txt = stopStatusOf(stop);
    expect(txt).toContain('May 31, 2026');
    expect(txt).not.toMatch(/\\d{1,2}:\\d{2}/);
  });
});
