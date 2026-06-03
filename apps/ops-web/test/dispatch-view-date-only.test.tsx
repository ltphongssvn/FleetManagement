// apps/ops-web/test/dispatch-view-date-only.test.tsx
// outside-in strict TDD RED (L0): the Lệnh điều xe board renders Ngày dự kiến
// as date-only ('May 30, 2026'), no time. Underlying datetime is unchanged;
// only the displayed string drops the time, for app-wide consistency.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { DispatchView } from '@/features/dispatch/DispatchView';
import type { DispatchBoardRoadRun } from '@/features/dispatch/types';
afterEach(cleanup);
const refs = {
  drivers: [], vehicles: [], customers: [], cargoTypes: [],
  pickupWarehouses: [], deliveryWarehouses: [], driverVehicleAssignments: [],
};
const run: DispatchBoardRoadRun = {
  roadRunId: '33333333-3333-4333-8333-333333333333',
  state: 'planned',
  assignedOperatorId: null,
  assignedAssetId: null,
  plannedStartAt: '2026-05-30T07:12:00.000Z',
  stopCount: 0,
  transportOrderRefs: ['XTT.05-001'],
  customerName: null,
  stops: [],
};
function dataRow(): HTMLElement {
  const rows = screen.getAllByRole('row');
  const row = rows[1];
  if (row === undefined) throw new Error('expected a data row');
  return row;
}
describe('DispatchView date-only Ngày dự kiến', () => {
  it('renders the planned-start cell as date only (no time)', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const cells = within(dataRow()).getAllByRole('cell');
    const plannedCell = cells[4];
    if (plannedCell === undefined) throw new Error('expected a planned-start cell');
    expect(plannedCell.textContent).toContain('May 30, 2026');
    expect(plannedCell.textContent).not.toMatch(/\\d{1,2}:\\d{2}/);
    expect(plannedCell.textContent).not.toMatch(/AM|PM/);
  });
});
