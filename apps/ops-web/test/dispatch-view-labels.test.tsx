// apps/ops-web/test/dispatch-view-labels.test.tsx
// T4 invariant on the LIVE board (DispatchView): human-readable identifiers
// only — never a raw UUID. Re-homed from the deleted DispatchBoard test after
// DispatchView became the production board surface. DispatchView resolves
// assignedOperatorId/assignedAssetId via reference lookups and surfaces the
// dispatcher-entered Số lệnh (transportOrderRefs[0]).
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
  customerName: null,
  customerPhone: null,
  stops: [],
};
describe('DispatchView - human-readable labels (T4)', () => {
  it('uses the Số lệnh column header, not Mã lệnh or Mã đơn', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toContain('Số lệnh');
    expect(headers).not.toContain('Mã lệnh');
    expect(headers).not.toContain('Mã đơn');
  });
  it('renders the dispatcher-entered order ref, not a UUID slice', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const row = dataRow();
    expect(within(row).getByText(/XT[.]0067/)).toBeInTheDocument();
    expect(row.textContent).not.toContain(RUN_ID.slice(0, 8));
  });
  it('resolves operator UUID to driver name', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const row = dataRow();
    expect(within(row).getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(row.textContent).not.toContain(DRIVER_ID);
  });
  it('resolves vehicle UUID to plate', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const row = dataRow();
    expect(within(row).getByText('51C-12345')).toBeInTheDocument();
    expect(row.textContent).not.toContain(VEHICLE_ID);
  });
  it('falls back to em-dash for an unknown operator id (no UUID leak)', () => {
    const UNKNOWN = '99999999-9999-4999-8999-999999999999';
    const r2: DispatchBoardRoadRun = { ...run, assignedOperatorId: UNKNOWN, assignedAssetId: null, plannedStartAt: null, transportOrderRefs: ['XT.0099'], stops: [] };
    render(<DispatchView initialRuns={[r2]} refs={{ ...refs, drivers: [], vehicles: [] }} />);
    expect(dataRow().textContent).not.toContain(UNKNOWN);
  });
  it('renders em-dash for an unparseable plannedStartAt', () => {
    const r3: DispatchBoardRoadRun = { ...run, plannedStartAt: 'not-a-real-date', transportOrderRefs: ['XT.0001'], stops: [] };
    render(<DispatchView initialRuns={[r3]} refs={refs} />);
    const cells = within(dataRow()).getAllByRole('cell');
    const plannedCell = cells[4];
    if (plannedCell === undefined) throw new Error('expected a planned-start cell');
    expect(plannedCell.textContent).toBe('—');
  });
});
