// apps/ops-web/test/dispatch-view-tenhang-column.test.tsx
// T18 (2026): permanent business rule - the Lenh dieu xe board shows a Ten
// hang (cargo type name) column. The value is the SERVER-resolved cargoName
// (road_run_transport_order -> transport_order -> cargo_type); null renders
// an em-dash (no cargo type on the order, or weights unresolved).
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { DispatchView } from '@/features/dispatch/DispatchView';
import type { DispatchBoardRoadRun } from '@/features/dispatch/types';
afterEach(cleanup);
const DRIVER_ID = '00000000-0000-0000-0000-0000000000bb';
const VEHICLE_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const refs = {
  drivers: [{ id: DRIVER_ID, label: 'Nguyen Van A' }],
  vehicles: [{ id: VEHICLE_ID, label: '51C-12345' }],
  customers: [], cargoTypes: [], pickupWarehouses: [], deliveryWarehouses: [],
  driverVehicleAssignments: [],
};
function dataRow(): HTMLElement {
  const rows = screen.getAllByRole('row');
  const row = rows[1];
  if (row === undefined) throw new Error('expected a data row');
  return row;
}
const run: DispatchBoardRoadRun = {
  roadRunId: RUN_ID,
  state: 'dispatched',
  assignedOperatorId: DRIVER_ID,
  assignedAssetId: VEHICLE_ID,
  driverName: null,
  vehiclePlate: null,
  plannedStartAt: '2026-04-28T09:00:00.000Z',
  stopCount: 2,
  transportOrderRefs: ['XT.0067'],
  customerName: null,
  customerPhone: null,
  cargoName: 'Gạo',
  weightDiffKg: null,
  stops: [],
};
describe('DispatchView - Ten hang column', () => {
  it('renders a Ten hang column header', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toContain('Tên hàng');
  });
  it('renders the row cargo name in the board', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const row = dataRow();
    expect(within(row).getByText('Gạo')).toBeInTheDocument();
  });
  it('renders em-dash when cargoName is null', () => {
    const r2: DispatchBoardRoadRun = { ...run, cargoName: null, transportOrderRefs: ['XT.0099'] };
    render(<DispatchView initialRuns={[r2]} refs={refs} />);
    const cell = screen.getByTestId('dispatch-board-cargo-XT.0099');
    expect(cell.textContent).toBe('—');
  });
});
