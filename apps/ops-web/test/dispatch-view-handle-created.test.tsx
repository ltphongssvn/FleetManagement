// apps/ops-web/test/dispatch-view-handle-created.test.tsx
// L1 coverage for DispatchView.handleCreated -- the named callback wired to the
// create form onCreated prop. T38: the create form is create-on-demand behind a
// drawer, so the test opens the drawer (open-create-order) to mount the stubbed
// form, which then fires onCreated and drives handleCreated -> pushOptimisticRow.
// Mocks NaturalLanguageCreateForm (the form DispatchView now renders) in its own
// file because the module-wide vi.mock would otherwise conflict with the real
// form used by dispatch-view-optimistic.test.tsx.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { DispatchBoardRoadRun } from '../src/features/dispatch/types';

afterEach(cleanup);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

// Stub NaturalLanguageCreateForm so it fires onCreated synchronously on mount.
// It only mounts once the drawer is opened, so opening the drawer is what
// invokes DispatchView handleCreated (v8 records the function as executed).
vi.mock('../src/features/dispatch/NaturalLanguageCreateForm', () => ({
  NaturalLanguageCreateForm: ({ onCreated }: { onCreated?: (ref: string, op: { operatorId: string; assetId: string }) => void }) => {
    if (onCreated) {
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

describe('DispatchView -- handleCreated wired to the create form onCreated', () => {
  it('inserts an optimistic row when the drawer form fires onCreated', async () => {
    render(<DispatchView initialRuns={initialRuns} refs={refs} />);
    fireEvent.click(screen.getByTestId('open-create-order'));
    await waitFor(() => {
      expect(screen.getByTestId('dispatch-board-row-XTT.05-form')).toBeTruthy();
    });
  });

  // Regression: onCreated closes the drawer, so a Số Lệnh banner rendered
  // INSIDE the form was unmounted in the same commit that assigned the
  // number -- the dispatcher lost the order number and eight e2e specs raced
  // the unmount. The board owns the banner now, so it must survive.
  it('keeps the So Lenh confirmation visible after the drawer closes', async () => {
    render(<DispatchView initialRuns={initialRuns} refs={refs} />);
    fireEvent.click(screen.getByTestId('open-create-order'));
    await waitFor(() => {
      expect(screen.getByTestId('dispatch-board-created-ref').textContent).toContain('XTT.05-form');
    });
  });

  // WCAG 4.1.3: a live region that is mounted on demand is never monitored by
  // assistive technology. The container must exist from first paint, empty.
  //
  // T70: queried by test id, not by role alone. This region used to be the
  // only role=status node on the board, so a bare role query resolved it
  // unambiguously -- by accident, not by contract. The empty-state primitive
  // is also a status region (an empty area must announce WHY it is empty), so
  // a board with no rows now legitimately has two. The test id names the
  // load-bearing region -- the So Lenh announcement -- so this assertion
  // stays pinned to the thing it is actually about.
  it('renders the live-region container before any order is created', () => {
    render(<DispatchView initialRuns={initialRuns} refs={refs} />);
    const region = screen.getByTestId('dispatch-board-created-ref');
    expect(region).toBeTruthy();
    expect(region.textContent).toBe('');
  });
});
