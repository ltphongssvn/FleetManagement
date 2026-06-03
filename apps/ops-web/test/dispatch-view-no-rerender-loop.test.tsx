// apps/ops-web/test/dispatch-view-no-rerender-loop.test.tsx
// REGRESSION L1 (2026): after an optimistic row is pushed, the DispatchView
// must NOT enter an unbounded re-render / effect loop while the server
// projection lags (initialRuns keeps arriving as a fresh array reference from
// router.refresh() but does not yet contain the new ref). The loop manifested
// in production as a continuous RSC prefetch storm (?_rsc= -> ERR_INSUFFICIENT_
// RESOURCES) and a perpetually blinking Lệnh điều xe table.
//
// Root cause: the prune useEffect depended on [initialRuns, stickyRuns] and
// called setStickyRuns; with a new initialRuns reference each refresh and a
// ref that never matched, it re-ran every render. 2026 best practice
// (react.dev effects must converge; nextjs.org prefetching): the effect must
// reach a fixed point — pruning only when a real change is needed, and never
// re-setting identical state.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type * as ReactModule from 'react';
const mockUseActionState = vi.fn();
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof ReactModule>('react');
  return { ...actual, useActionState: mockUseActionState };
});
import { render, screen, cleanup, act } from '@testing-library/react';
import type { DispatchBoardRoadRun } from '../src/features/dispatch/types';

afterEach(cleanup);
beforeEach(() => {
  mockUseActionState.mockReturnValue([undefined, vi.fn(), false]);
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('../src/features/dispatch/create-order.action.js', () => ({
  createOrder: vi.fn(() => undefined),
}));

const baseRun: DispatchBoardRoadRun = {
  roadRunId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  state: 'planned',
  assignedOperatorId: null,
  assignedAssetId: null,
  plannedStartAt: '2026-05-01T08:00:00.000Z',
  stopCount: 1,
  transportOrderRefs: ['XTT.05-001'],
  customerName: null,
  customerPhone: null,
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

describe('DispatchView — no re-render loop while projection lags', () => {
  it('reaches a stable fixed point after pushing an optimistic row when initialRuns keeps arriving as a fresh reference without the new ref', () => {
    let captured: ((ref: string, op: { operatorId: string; assetId: string }) => void) | null = null;
    const { rerender } = render(
      <DispatchView initialRuns={[{ ...baseRun }]} refs={refs} onMountForTest={(push) => { captured = push; }} />,
    );
    act(() => { if (captured) captured('XTT.05-002', { operatorId: 'op-1', assetId: 'veh-1' }); });
    expect(screen.queryAllByTestId('dispatch-board-row-XTT.05-002').length).toBe(1);

    // Simulate several router.refresh() cycles where the projection has NOT yet
    // caught up: a FRESH initialRuns array (new reference) each time, still
    // lacking XTT.05-002. A converging effect must not keep mutating state.
    const origError = console.error;
    for (let i = 0; i < 5; i++) {
      act(() => { rerender(<DispatchView initialRuns={[{ ...baseRun }]} refs={refs} onMountForTest={() => { /* noop */ }} />); });
    }
    console.error = origError;
    // The optimistic row must still be present exactly once (not duplicated,
    // not flickering) and React must not warn about a maximum update depth.
    expect(screen.queryAllByTestId('dispatch-board-row-XTT.05-002').length).toBe(1);
  });

  it('does not exceed React maximum update depth after an optimistic push with lagging projection', () => {
    const errors: string[] = [];
    const orig = console.error;
    console.error = (...args: unknown[]) => { errors.push(String(args[0])); };
    try {
      let captured: ((ref: string, op: { operatorId: string; assetId: string }) => void) | null = null;
      const { rerender } = render(
        <DispatchView initialRuns={[{ ...baseRun }]} refs={refs} onMountForTest={(push) => { captured = push; }} />,
      );
      act(() => { if (captured) captured('XTT.05-003', { operatorId: 'op-1', assetId: 'veh-1' }); });
      for (let i = 0; i < 10; i++) {
        act(() => { rerender(<DispatchView initialRuns={[{ ...baseRun }]} refs={refs} onMountForTest={() => { /* noop */ }} />); });
      }
    } finally {
      console.error = orig;
    }
    const depthWarn = errors.find((e) => e.includes('Maximum update depth'));
    expect(depthWarn, 'React must not warn about maximum update depth (effect loop)').toBeUndefined();
  });
});
