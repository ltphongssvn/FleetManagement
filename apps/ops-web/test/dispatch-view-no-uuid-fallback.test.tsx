// apps/ops-web/test/dispatch-view-no-uuid-fallback.test.tsx
// outside-in strict TDD RED (L1): when a road-run has NO transport-order ref,
// the Số lệnh cell must fall back to em-dash, never the raw roadRunId UUID.
// Business invariant: no opaque UUID in user-facing UI. labels.formatOrderRef
// already returns DASH on empty; the board must route the empty case through it
// instead of `?? r.roadRunId`.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DispatchView } from '@/features/dispatch/DispatchView';
import type { DispatchBoardRoadRun } from '@/features/dispatch/types';
afterEach(cleanup);
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const refs = {
  drivers: [],
  vehicles: [],
  customers: [],
  cargoTypes: [],
  pickupWarehouses: [],
  deliveryWarehouses: [],
  driverVehicleAssignments: [],
};
const run: DispatchBoardRoadRun = {
  roadRunId: RUN_ID,
  state: 'planned',
  assignedOperatorId: null,
  assignedAssetId: null,
  driverName: null,
  vehiclePlate: null,
  plannedStartAt: null,
  stopCount: 0,
  transportOrderRefs: [],
  customerName: null,
  customerPhone: null,
  cargoName: null,
  weightDiffKg: null,
  stops: [],
};
describe('DispatchView - no UUID fallback in Số lệnh', () => {
  it('does NOT render the roadRunId UUID when transportOrderRefs is empty', () => {
    render(<DispatchView initialRuns={[run]} refs={refs} />);
    const rows = screen.getAllByRole('row');
    const dataRow = rows[1];
    if (dataRow === undefined) throw new Error('expected a data row');
    expect(dataRow.textContent).not.toContain(RUN_ID);
    expect(dataRow.textContent).not.toContain(RUN_ID.slice(0, 8));
    // The roadRunId must not leak via data-testid attributes either.
    const withTestId = dataRow.querySelectorAll('[data-testid]');
    for (const el of Array.from(withTestId)) {
      expect(el.getAttribute('data-testid') ?? '').not.toContain(RUN_ID);
    }
  });
});
