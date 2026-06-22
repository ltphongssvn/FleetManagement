// apps/ops-web/test/dispatch-view-cancelled-row-marker.test.tsx
// L1 (2026): after PR #32 removed the Trạng thái column, a cancelled order
// REMAINS on the board (projection keeps state='cancelled'; only a tombstone
// deletes). The dispatcher must still SEE the cancellation: a cancelled row
// renders a marker testid 'dispatch-board-row-cancelled-<ref>' carrying the
// localized 'Đã hủy' badge. Non-cancelled rows render no such marker.
// RED first: the board currently shows no cancelled indicator at all.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DispatchView } from '@/features/dispatch/DispatchView';
import type { DispatchBoardRoadRun } from '@/features/dispatch/types';
afterEach(cleanup);
const DRIVER_ID = '00000000-0000-0000-0000-0000000000bb';
const VEHICLE_ID = '22222222-2222-4222-8222-222222222222';
const refs = {
  drivers: [{ id: DRIVER_ID, label: 'Nguyễn Văn A' }],
  vehicles: [{ id: VEHICLE_ID, label: '51C-12345' }],
  customers: [], cargoTypes: [], pickupWarehouses: [], deliveryWarehouses: [],
  driverVehicleAssignments: [],
};
function baseRun(overrides: Partial<DispatchBoardRoadRun>): DispatchBoardRoadRun {
  return {
    roadRunId: '33333333-3333-4333-8333-333333333333',
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
    weightDiffKg: null,
    stops: [],
    ...overrides,
  };
}
describe('DispatchView - cancelled row marker', () => {
  it('renders a cancelled marker with Đã hủy for a cancelled row', () => {
    const run = baseRun({ state: 'cancelled', transportOrderRefs: ['XTT.06-001'] });
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const marker = screen.getByTestId('dispatch-board-row-cancelled-XTT.06-001');
    expect(marker).toBeInTheDocument();
    expect(marker.textContent).toContain('Đã hủy');
  });
  it('renders NO cancelled marker for a non-cancelled row', () => {
    const run = baseRun({ state: 'dispatched', transportOrderRefs: ['XTT.06-002'] });
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    expect(screen.queryByTestId('dispatch-board-row-cancelled-XTT.06-002')).toBeNull();
  });
});
