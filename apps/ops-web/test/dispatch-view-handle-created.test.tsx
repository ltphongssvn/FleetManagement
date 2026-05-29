// apps/ops-web/test/dispatch-view-handle-created.test.tsx
// L1 coverage for DispatchView.handleCreated — the named callback wired
// to CreateOrderForm's onCreated prop. Lives in its own file because the
// CreateOrderForm vi.mock hoists module-wide and would conflict with the
// real form used by dispatch-view-optimistic.test.tsx.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import type { DispatchBoardRoadRun } from '../src/features/dispatch/types';

afterEach(cleanup);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

// Stub CreateOrderForm so it fires onCreated synchronously on mount.
// This invokes DispatchView's handleCreated callback so v8 coverage
// records the function as executed.
vi.mock('../src/features/dispatch/CreateOrderForm', () => ({
  CreateOrderForm: ({ onCreated }: { onCreated?: (ref: string, op: { operatorId: string; assetId: string }) => void }) => {
    if (onCreated) {
      // Defer to next microtask so the parent finishes its current render
      // before the optimistic-state push (avoids 'setState during render').
      void Promise.resolve().then(() => { onCreated('XTT.05-form', { operatorId: 'op-1', assetId: 'veh-1' }); });
    }
    return null;
  },
}));

const { DispatchView } = await import('../src/features/dispatch/DispatchView');

const refs = {
  drivers: [{ id: 'op-1', label: 'Driver 1' }],
  vehicles: [{ id: 'veh-1', label: '62H 05194' }],
  customers: [],
  cargoTypes: [],
  pickupWarehouses: [],
  deliveryWarehouses: [],
  driverVehicleAssignments: [{ operatorId: 'op-1', vehicleId: 'veh-1' }],
  nextOrderRef: '',
};

const initialRuns: readonly DispatchBoardRoadRun[] = [];

describe('DispatchView — handleCreated wired to CreateOrderForm.onCreated', () => {
  it('inserts an optimistic row when the (stubbed) form fires onCreated on mount', async () => {
    render(<DispatchView initialRuns={initialRuns} refs={refs} />);
    await waitFor(() => {
      expect(screen.getByTestId('dispatch-board-row-XTT.05-form')).toBeTruthy();
    });
  });
});
