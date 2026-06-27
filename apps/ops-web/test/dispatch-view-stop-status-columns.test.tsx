// apps/ops-web/test/dispatch-view-stop-status-columns.test.tsx
// T10 RED-first: the live dispatcher home board (DispatchView's table) must
// show per-stop status columns (Điểm nhận hàng 1..4, Kho giao hàng 1), each
// showing the row's stop completion: 'Đã hoàn thành <time>' when visited,
// else 'Chưa tới'; empty slots show em-dash.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DispatchView } from '@/features/dispatch/DispatchView';
import type { DispatchBoardRoadRun } from '@/features/dispatch/types';
afterEach(cleanup);
const refs = {
  drivers: [{ id: 'op-1', label: 'NGUYỄN THANH PHONG' }],
  vehicles: [{ id: 'truck-7', label: '62H 05194' }],
  customers: [],
  cargoTypes: [],
  pickupWarehouses: [],
  deliveryWarehouses: [],
  driverVehicleAssignments: [],
};
const run: DispatchBoardRoadRun = {
  roadRunId: '11111111-1111-4111-8111-111111111111',
  state: 'started',
  assignedOperatorId: 'op-1',
  assignedAssetId: 'truck-7',
  driverName: null,
  vehiclePlate: null,
  plannedStartAt: '2026-05-30T08:00:00.000Z',
  stopCount: 5,
  transportOrderRefs: ['XTT.05-001'],
  customerName: null,
  customerPhone: null,
  weightDiffKg: null,
  stops: [
    { sequence: 1, stopType: 'pickup', warehouseName: 'Chơn Chính', arrivedAt: '2026-05-30T09:00:00.000Z', departedAt: '2026-05-30T09:15:00.000Z', proof: null },
    { sequence: 2, stopType: 'pickup', warehouseName: 'Cần Thơ', arrivedAt: null, departedAt: null, proof: null },
    { sequence: 3, stopType: 'pickup', warehouseName: 'Thốt Nốt', arrivedAt: null, departedAt: null, proof: null },
    { sequence: 4, stopType: 'pickup', warehouseName: 'Trí Mai', arrivedAt: null, departedAt: null, proof: null },
    { sequence: 5, stopType: 'delivery', warehouseName: 'ĐA NĂNG', arrivedAt: null, departedAt: null, proof: null },
  ],
};
describe('@fleet/ops-web - DispatchView per-stop status columns (T10)', () => {
  it('renders a column header for each fixed slot', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining([
      'Điểm nhận hàng 1', 'Điểm nhận hàng 2', 'Điểm nhận hàng 3', 'Điểm nhận hàng 4', 'Kho giao hàng',
    ]));
  });
  it('shows a completed time for an arrived stop and Chưa tới for the rest', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const c1 = screen.getByTestId('board-stop-status-XTT.05-001-pickup-1');
    expect(c1.textContent).toMatch(/Đã hoàn thành/);
    const c2 = screen.getByTestId('board-stop-status-XTT.05-001-pickup-2');
    expect(c2.textContent).toBe('Chưa tới');
    const d1 = screen.getByTestId('board-stop-status-XTT.05-001-delivery-1');
    expect(d1.textContent).toBe('Chưa tới');
  });
});
