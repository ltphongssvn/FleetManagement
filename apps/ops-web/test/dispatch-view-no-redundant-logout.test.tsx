// apps/ops-web/test/dispatch-view-no-redundant-logout.test.tsx
// RED (T60): the Lenh dieu xe board toolbar must NOT render a Dang xuat control.
// The canonical, globally-positioned logout lives in the AppShell header (top
// right of Bang dieu phoi). Mounting a second LogoutButton beside Xuat Excel
// produced two controls sharing ONE accessible name: a Playwright strict-mode
// ambiguity (a locator that resolves to 2 elements is a test that does not know
// what it is testing) and a WCAG consistent-identification / cognitive-load
// hazard, with a session-ending action one pixel from a benign export action.
//
// Contract asserted here:
//   1. DispatchView renders ZERO buttons named Dang xuat.
//   2. DispatchView STILL renders the Xuat Excel button (guards over-removal).
//   3. No logout control survives anywhere inside the dispatch-board subtree.
//
// Subtree scoping uses RTL within() over the board testid rather than raw
// querySelectorAll + textContent: the accessible-name query is the same axis
// Playwright strict mode judges on, and it avoids nullable-DOM narrowing that
// type-aware lint rejects as an unnecessary condition.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import type { DispatchBoardRoadRun } from '../src/features/dispatch/types';
afterEach(cleanup);
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
const { DispatchView } = await import('../src/features/dispatch/DispatchView');
const refs = {
  drivers: [{ id: 'op-1', label: 'Driver 1' }],
  vehicles: [{ id: 'veh-1', label: '62H 05194' }],
  customers: [], cargoTypes: [], pickupWarehouses: [], deliveryWarehouses: [],
  driverVehicleAssignments: [{ operatorId: 'op-1', vehicleId: 'veh-1' }],
  nextOrderRef: '',
};
const initialRuns: readonly DispatchBoardRoadRun[] = [];
const LOGOUT_LABEL = /ng xu.t/i;
const EXPORT_LABEL = /xu.t excel/i;
describe('DispatchView has no redundant logout control', () => {
  it('renders zero Dang xuat buttons in the board toolbar', () => {
    render(<DispatchView initialRuns={initialRuns} refs={refs} />);
    expect(screen.queryAllByRole('button', { name: LOGOUT_LABEL })).toHaveLength(0);
  });
  it('still renders exactly one Xuat Excel button (no over-removal)', () => {
    render(<DispatchView initialRuns={initialRuns} refs={refs} />);
    expect(screen.getAllByRole('button', { name: EXPORT_LABEL })).toHaveLength(1);
  });
  it('renders no logout control anywhere inside the dispatch-board subtree', () => {
    render(<DispatchView initialRuns={initialRuns} refs={refs} />);
    const board = screen.getByTestId('dispatch-board');
    expect(within(board).queryAllByRole('button', { name: LOGOUT_LABEL })).toHaveLength(0);
  });
});
