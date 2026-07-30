// apps/ops-web/test/dispatch-view-manual-netweight.test.tsx
// outside-in strict TDD RED (T33 Slice E): the Lenh dieu xe board must let a
// dispatcher ENTER a net weight by hand for a phieu-can the AI could not read.
// A stop whose proof.extractionStatus is not_found/unreadable already renders a
// Nhap KL button (board-stops.tsx); until now DispatchView never passed an
// onEnterNetWeight handler, so the button was inert. This wires it: clicking
// Nhap KL reveals an inline kg input; confirming calls the setManualNetWeight
// server action with the stop manifestId and the entered kg.
//
// The action mock fn is created via vi.hoisted so it is initialised BEFORE the
// hoisted vi.mock factory references it (vitest hoists vi.mock to the top of the
// module; a plain const would be in the temporal dead zone at that point).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const { setManualNetWeight } = vi.hoisted(() => ({
  setManualNetWeight: vi.fn(() => Promise.resolve({ status: 'ok' as const })),
}));
vi.mock('@/features/dispatch/set-manual-net-weight.action', () => ({ setManualNetWeight }));

import { DispatchView } from '@/features/dispatch/DispatchView';
import type { DispatchBoardRoadRun, DispatchBoardStop } from '@/features/dispatch/types';

afterEach(cleanup);
beforeEach(() => { setManualNetWeight.mockClear(); });

const refs = {
  drivers: [{ id: 'op-1', label: 'NGUYEN THANH PHONG' }],
  vehicles: [{ id: 'truck-7', label: '62H 05194' }],
  customers: [],
  cargoTypes: [],
  pickupWarehouses: [],
  deliveryWarehouses: [],
  driverVehicleAssignments: [],
};

const MANIFEST_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function needsEntryStop(): DispatchBoardStop {
  return {
    sequence: 1,
    stopType: 'pickup',
    warehouseName: 'Kho A',
    arrivedAt: null,
    departedAt: null,
    proof: {
      manifestId: MANIFEST_ID,
      photoUrl: 'https://s3.example/x.jpg',
      capturedAt: '2026-06-15T03:04:05.000Z',
      extractedNetWeightKg: null,
      extractionStatus: 'not_found',
      extractionReason: 'non_standard_format',
    },
  };
}

function row(stops: readonly DispatchBoardStop[]): DispatchBoardRoadRun {
  return {
    roadRunId: '11111111-1111-4111-8111-111111111111',
    state: 'started',
    assignedOperatorId: 'op-1',
    assignedAssetId: 'truck-7',
    driverName: null,
    vehiclePlate: null,
    plannedStartAt: '2026-05-30T08:00:00.000Z',
    stopCount: 1,
    transportOrderRefs: ['XTT.05-001'],
    customerName: null,
    customerPhone: null,
    cargoName: null,
    weightDiffKg: null,
    stops,
  };
}

describe('@fleet/ops-web - DispatchView manual net-weight entry (T33)', () => {
  it('renders a live Nhap KL button for a not_found proof stop', () => {
    render(<DispatchView initialRuns={[row([needsEntryStop()])]} refs={refs} />);
    const btn = screen.getByTestId('board-stop-netweight-needsentry-XTT.05-001-pickup-1');
    expect(btn.textContent).toBe('Nhập KL');
  });

  it('reveals an inline kg input when Nhap KL is clicked', () => {
    render(<DispatchView initialRuns={[row([needsEntryStop()])]} refs={refs} />);
    fireEvent.click(screen.getByTestId('board-stop-netweight-needsentry-XTT.05-001-pickup-1'));
    const input = screen.getByTestId('manual-netweight-input-' + MANIFEST_ID);
    expect(input).toBeTruthy();
  });

  it('calls setManualNetWeight with the manifestId and entered kg on confirm', () => {
    render(<DispatchView initialRuns={[row([needsEntryStop()])]} refs={refs} />);
    fireEvent.click(screen.getByTestId('board-stop-netweight-needsentry-XTT.05-001-pickup-1'));
    const input = screen.getByTestId('manual-netweight-input-' + MANIFEST_ID);
    fireEvent.change(input, { target: { value: '19730' } });
    fireEvent.click(screen.getByTestId('manual-netweight-confirm-' + MANIFEST_ID));
    expect(setManualNetWeight).toHaveBeenCalledTimes(1);
    expect(setManualNetWeight).toHaveBeenCalledWith({ manifestId: MANIFEST_ID, extractedNetWeightKg: 19730 });
  });

  it('does not call the action when the input is empty or non-positive', () => {
    render(<DispatchView initialRuns={[row([needsEntryStop()])]} refs={refs} />);
    fireEvent.click(screen.getByTestId('board-stop-netweight-needsentry-XTT.05-001-pickup-1'));
    fireEvent.click(screen.getByTestId('manual-netweight-confirm-' + MANIFEST_ID));
    expect(setManualNetWeight).not.toHaveBeenCalled();
  });
});
