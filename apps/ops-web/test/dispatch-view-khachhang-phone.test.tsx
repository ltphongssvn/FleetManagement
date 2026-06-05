// apps/ops-web/test/dispatch-view-khachhang-phone.test.tsx
// L2 (2026): permanent business rule — the Lệnh điều xe board displays the
// customer's Số điện thoại next to Khách hàng in the customer cell.
//
// Business invariant: when a row's customerPhone is set, the board renders that
// phone in the Khách hàng cell; when customerPhone is null, no phone is shown
// (no stray text / no leak), only the customer name (or em-dash) remains.
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
  customerPhone: '0901234567',
  stops: [],
};
describe('DispatchView - Khách hàng shows Số điện thoại', () => {
  it('renders the customer phone in the Khách hàng cell', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const cells = within(dataRow()).getAllByRole('cell');
    const customerCell = cells[1];
    if (customerCell === undefined) throw new Error('expected a customer cell');
    expect(within(customerCell).getByText('0901234567')).toBeInTheDocument();
  });
  it('still renders the customer name alongside the phone', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const cells = within(dataRow()).getAllByRole('cell');
    const customerCell = cells[1];
    if (customerCell === undefined) throw new Error('expected a customer cell');
    expect(within(customerCell).getByText('Công ty Vận Tải Số 1')).toBeInTheDocument();
  });
  it('shows no phone text when customerPhone is null (no leak)', () => {
    const r2: DispatchBoardRoadRun = { ...run, customerPhone: null, transportOrderRefs: ['XT.0099'] };
    render(<DispatchView initialRuns={[r2]} refs={refs} />);
    const cells = within(dataRow()).getAllByRole('cell');
    const customerCell = cells[1];
    if (customerCell === undefined) throw new Error('expected a customer cell');
    expect(within(customerCell).queryByText('0901234567')).toBeNull();
    expect(within(customerCell).getByText('Công ty Vận Tải Số 1')).toBeInTheDocument();
  });
});
