// apps/ops-web/test/dispatch-view-refetch-on-focus.test.tsx
// RED-FIRST L1 (2026): the dispatcher's Lệnh điều xe board must refetch when the
// tab regains focus, so a row created elsewhere (another dispatcher / another
// device) appears without a manual reload. The professional default for App
// Router is router.refresh() on document visibilitychange->'visible' (and on
// window 'focus'): it re-pulls the RSC payload and MERGES it without nuking
// client state (the optimistic stickyRuns + any form inputs survive), unlike a
// hard location.reload(). The three prior fixes only fired on
// navigation/mutation; none fired on tab-focus — this test encodes that gap.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type * as ReactModule from 'react';

const mockUseActionState = vi.fn();
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof ReactModule>('react');
  return { ...actual, useActionState: mockUseActionState };
});

// A STABLE, hoisted refresh spy. The other DispatchView tests mint a fresh
// vi.fn() inside useRouter() (not assertable); here we need one persistent spy
// so we can assert it fires on focus/visibility.
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock, push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('../src/features/dispatch/create-order.action.js', () => ({
  createOrder: vi.fn(() => undefined),
}));

import { render, cleanup, act } from '@testing-library/react';
import type { DispatchBoardRoadRun } from '../src/features/dispatch/types';

afterEach(cleanup);
beforeEach(() => {
  mockUseActionState.mockReturnValue([undefined, vi.fn(), false]);
  refreshMock.mockClear();
});

const baseRun: DispatchBoardRoadRun = {
  roadRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  state: 'planned',
  assignedOperatorId: null,
  assignedAssetId: null,
  driverName: null,
  vehiclePlate: null,
  plannedStartAt: '2026-05-01T08:00:00.000Z',
  stopCount: 1,
  transportOrderRefs: ['XTT.05-001'],
  customerName: null,
  customerPhone: null,
  weightDiffKg: null,
  stops: [],
};
const refs = {
  drivers: [{ id: 'op-1', label: 'Driver 1' }],
  vehicles: [{ id: 'veh-1', label: '62H 05194' }],
  customers: [], cargoTypes: [], pickupWarehouses: [], deliveryWarehouses: [],
  driverVehicleAssignments: [{ operatorId: 'op-1', vehicleId: 'veh-1' }],
  nextOrderRef: '',
};

const { DispatchView } = await import('../src/features/dispatch/DispatchView');

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

describe('DispatchView — refetch on tab focus / visibility', () => {
  it('calls router.refresh() when the tab becomes visible again (visibilitychange -> visible)', () => {
    setVisibility('visible');
    render(<DispatchView initialRuns={[{ ...baseRun }]} refs={refs} />);
    // Mount itself must NOT trigger a refetch (only focus/visibility should).
    refreshMock.mockClear();

    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => {
      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(
      refreshMock.mock.calls.length,
      'router.refresh() must fire once when the tab returns to visible',
    ).toBeGreaterThanOrEqual(1);
  });

  it('does NOT call router.refresh() when the tab goes hidden', () => {
    setVisibility('visible');
    render(<DispatchView initialRuns={[{ ...baseRun }]} refs={refs} />);
    refreshMock.mockClear();

    act(() => {
      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(
      refreshMock.mock.calls.length,
      'a tab going hidden must not refetch',
    ).toBe(0);
  });

  it('calls router.refresh() on window focus', () => {
    setVisibility('visible');
    render(<DispatchView initialRuns={[{ ...baseRun }]} refs={refs} />);
    refreshMock.mockClear();

    act(() => { window.dispatchEvent(new Event('focus')); });

    expect(
      refreshMock.mock.calls.length,
      'router.refresh() must fire when the window regains focus',
    ).toBeGreaterThanOrEqual(1);
  });
});
