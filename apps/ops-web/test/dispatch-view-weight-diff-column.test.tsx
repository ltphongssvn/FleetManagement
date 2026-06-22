// apps/ops-web/test/dispatch-view-weight-diff-column.test.tsx
// outside-in strict TDD RED (Feature 3): the Lệnh điều xe board shows a
// "Chênh lệch" (pickup-vs-delivery net-weight difference) column. The value is
// the SERVER-computed weightDiffKg (positive => more picked up than delivered),
// formatted vi-VN as "<n> kg"; a null diff (weights incomplete) shows em-dash.
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

function row(over: Partial<DispatchBoardRoadRun>): DispatchBoardRoadRun {
  return {
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
    stops: [],
    ...over,
  };
}

describe('@fleet/ops-web - DispatchView weight-diff column (Feature 3)', () => {
  it('renders a "Chênh lệch" column header', () => {
    render(<DispatchView initialRuns={[row({})]} refs={refs} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Chênh lệch']));
  });

  it('shows the vi-VN formatted kg difference for a row with a numeric weightDiffKg', () => {
    render(<DispatchView initialRuns={[row({ weightDiffKg: -7140 })]} refs={refs} />);
    const cell = screen.getByTestId('dispatch-board-weightdiff-XTT.05-001');
    expect(cell.textContent).toBe('-7.140 kg');
  });

  it('shows a positive difference with grouping', () => {
    render(<DispatchView initialRuns={[row({ weightDiffKg: 12500 })]} refs={refs} />);
    const cell = screen.getByTestId('dispatch-board-weightdiff-XTT.05-001');
    expect(cell.textContent).toBe('12.500 kg');
  });

  it('shows em-dash when weightDiffKg is null (weights incomplete)', () => {
    render(<DispatchView initialRuns={[row({ weightDiffKg: null })]} refs={refs} />);
    const cell = screen.getByTestId('dispatch-board-weightdiff-XTT.05-001');
    expect(cell.textContent).toBe('—');
  });
});
