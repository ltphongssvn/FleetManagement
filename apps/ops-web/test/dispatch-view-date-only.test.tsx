// apps/ops-web/test/dispatch-view-date-only.test.tsx
// outside-in strict TDD RED (t65 Vietnamese-date-format arc): the Lệnh điều xe
// board renders Ngày dự kiến as a PURE VIETNAMESE date-only string, dd/MM/yyyy.
//
// This spec previously asserted the en-US form (May 30, 2026). That expectation
// was itself the defect made permanent in a test: the product is Vietnamese-only
// and its dispatchers read 30/05/2026. The date-only intent of the original
// spec is preserved below (no clock, no AM/PM); only the locale expectation
// moves, plus a timezone case the old spec never had.
//
// TIMEZONE. plannedStartAt is a UTC instant. 2026-05-30T07:12Z is 14:12 on
// 30/05 in Asia/Ho_Chi_Minh, so the rendered day is 30. The second case is the
// one the shipped code got WRONG: 2026-05-30T17:30Z is already 00:30 on 31/05
// in Vietnam, and the board formatter carried no timeZone at all, so on a UTC
// host it printed the previous day. Asserting both instants is what makes this
// a correctness spec rather than a cosmetic one.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { isVnDateString } from '@fleet/sync-protocol';
import { DispatchView } from '@/features/dispatch/DispatchView';
import type { DispatchBoardRoadRun } from '@/features/dispatch/types';
afterEach(cleanup);
const refs = {
  drivers: [], vehicles: [], customers: [], cargoTypes: [],
  pickupWarehouses: [], deliveryWarehouses: [], driverVehicleAssignments: [],
};
function runAt(plannedStartAt: string | null): DispatchBoardRoadRun {
  return {
    roadRunId: '33333333-3333-4333-8333-333333333333',
    state: 'planned',
    assignedOperatorId: null,
    assignedAssetId: null,
    driverName: null,
    vehiclePlate: null,
    plannedStartAt,
    stopCount: 0,
    transportOrderRefs: ['XTT.05-001'],
    customerName: null,
    customerPhone: null,
    cargoName: null,
    weightDiffKg: null,
    stops: [],
  };
}
function plannedCellText(): string {
  const rows = screen.getAllByRole('row');
  const row = rows[1];
  if (row === undefined) throw new Error('expected a data row');
  const cells = within(row).getAllByRole('cell');
  const plannedCell = cells[5];
  if (plannedCell === undefined) throw new Error('expected a planned-start cell');
  return plannedCell.textContent ?? '';
}
describe('DispatchView Ngày dự kiến renders a pure Vietnamese date', () => {
  it('renders the planned-start cell as dd/MM/yyyy', () => {
    render(<DispatchView initialRuns={[runAt('2026-05-30T07:12:00.000Z')]} refs={refs} />);
    expect(plannedCellText()).toBe('30/05/2026');
  });
  it('never renders an English month abbreviation', () => {
    render(<DispatchView initialRuns={[runAt('2026-05-30T07:12:00.000Z')]} refs={refs} />);
    expect(plannedCellText()).not.toContain('May');
  });
  it('stays date-only: no clock and no AM or PM marker', () => {
    render(<DispatchView initialRuns={[runAt('2026-05-30T07:12:00.000Z')]} refs={refs} />);
    const txt = plannedCellText();
    expect(txt).not.toMatch(/\d{1,2}:\d{2}/);
    expect(txt).not.toMatch(/AM|PM/);
  });
  it('satisfies the shared Vietnamese date contract predicate', () => {
    render(<DispatchView initialRuns={[runAt('2026-05-30T07:12:00.000Z')]} refs={refs} />);
    expect(isVnDateString(plannedCellText())).toBe(true);
  });
  it('uses the Asia/Ho_Chi_Minh calendar day, not the UTC one', () => {
    render(<DispatchView initialRuns={[runAt('2026-05-30T17:30:00.000Z')]} refs={refs} />);
    expect(plannedCellText()).toBe('31/05/2026');
  });
  it('renders the em-dash fallback when there is no planned start', () => {
    render(<DispatchView initialRuns={[runAt(null)]} refs={refs} />);
    expect(plannedCellText()).toBe('\u2014');
  });
});
