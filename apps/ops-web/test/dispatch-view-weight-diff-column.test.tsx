// apps/ops-web/test/dispatch-view-weight-diff-column.test.tsx
// outside-in strict TDD RED (Feature 3, signed-display revision): the Lenh dieu
// xe board Chenh lech column = server weightDiffKg = sum(Diem nhan hang) minus
// Kho giao hang. Sign contract: negative shows a minus sign; positive and zero
// show NO sign (no plus); negative-zero from float subtraction collapses to a
// bare zero; null (weights incomplete) shows em-dash. Header is relabelled to
// name the operands explicitly so the dispatcher reads the direction.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DispatchView } from '@/features/dispatch/DispatchView';
import type { DispatchBoardRoadRun } from '@/features/dispatch/types';
afterEach(cleanup);

const refs = {
  drivers: [{ id: 'op-1', label: 'NGUYEN THANH PHONG' }],
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
  it('renders the relabelled Chênh lệch (Số nhận - Số giao) column header', () => {
    render(<DispatchView initialRuns={[row({})]} refs={refs} />);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Chênh lệch (Số nhận - Số giao)']));
  });

  it('shows a NEGATIVE difference with a minus sign (delivery exceeded pickup)', () => {
    render(<DispatchView initialRuns={[row({ weightDiffKg: -7140 })]} refs={refs} />);
    const cell = screen.getByTestId('dispatch-board-weightdiff-XTT.05-001');
    expect(cell.textContent).toBe('-7.140 kg');
  });

  it('shows a POSITIVE difference with grouping and NO plus sign', () => {
    render(<DispatchView initialRuns={[row({ weightDiffKg: 12500 })]} refs={refs} />);
    const cell = screen.getByTestId('dispatch-board-weightdiff-XTT.05-001');
    expect(cell.textContent).toBe('12.500 kg');
  });

  it('shows a bare zero when pickup equals delivery', () => {
    render(<DispatchView initialRuns={[row({ weightDiffKg: 0 })]} refs={refs} />);
    const cell = screen.getByTestId('dispatch-board-weightdiff-XTT.05-001');
    expect(cell.textContent).toBe('0 kg');
  });

  it('collapses negative zero from float subtraction to a bare zero (no minus)', () => {
    render(<DispatchView initialRuns={[row({ weightDiffKg: -0 })]} refs={refs} />);
    const cell = screen.getByTestId('dispatch-board-weightdiff-XTT.05-001');
    expect(cell.textContent).toBe('0 kg');
  });

  it('shows em-dash when weightDiffKg is null (weights incomplete)', () => {
    render(<DispatchView initialRuns={[row({ weightDiffKg: null })]} refs={refs} />);
    const cell = screen.getByTestId('dispatch-board-weightdiff-XTT.05-001');
    expect(cell.textContent).toBe('—');
  });
});
