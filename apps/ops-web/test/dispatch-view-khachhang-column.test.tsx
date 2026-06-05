// apps/ops-web/test/dispatch-view-khachhang-column.test.tsx
// L2 (2026): permanent business rule — the Lệnh điều xe board shows a Khách
// hàng (customer) column in place of the Trạng thái (state) column.
//
// Business invariant: the board renders a Khách hàng columnheader showing the
// row's customerName, and renders NO Trạng thái columnheader.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { DispatchView } from '@/features/dispatch/DispatchView';
import type { DispatchBoardRoadRun } from '@/features/dispatch/types';
afterEach(cleanup);
const DRIVER_ID = '00000000-0000-0000-0000-0000000000bb';
const VEHICLE_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const refs = {
  drivers: [{ id: DRIVER_ID, label: 'Nguyễn Văn A' }],
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
  customerName: 'Công ty Vận Tải Số 1',
  customerPhone: null,
  stops: [],
};
describe('DispatchView - Khách hàng column replaces Trạng thái', () => {
  it('renders a Khách hàng column header', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toContain('Khách hàng');
  });
  it('does NOT render a Trạng thái column header', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).not.toContain('Trạng thái');
  });
  it('renders the row customer name in the board', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const row = dataRow();
    expect(within(row).getByText('Công ty Vận Tải Số 1')).toBeInTheDocument();
  });
  it('renders em-dash when customerName is null (no leak)', () => {
    const r2: DispatchBoardRoadRun = { ...run, customerName: null, transportOrderRefs: ['XT.0099'] };
    render(<DispatchView initialRuns={[r2]} refs={refs} />);
    const cells = within(dataRow()).getAllByRole('cell');
    const customerCell = cells[1];
    if (customerCell === undefined) throw new Error('expected a customer cell');
    expect(customerCell.textContent).toBe('—');
  });
});
