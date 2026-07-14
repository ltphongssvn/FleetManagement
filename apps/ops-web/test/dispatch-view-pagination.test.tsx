// apps/ops-web/test/dispatch-view-pagination.test.tsx
// L1 RED-first: the Lệnh điều xe board (DispatchView) must render, when given a
// pagination prop, (1) Active/Finished filter tabs (Active current by default),
// (2) a bottom pagination control with numbered page links, (3) a jump-to-page
// search input, and (4) a total count. Navigation is URL-state via plain <a>
// (RSC-shareable; matches the board-row anchor escape hatch). The pagination
// prop + UI do not exist yet => RED. Existing DispatchView callers omit the prop
// and must keep rendering unchanged (covered by sibling tests).
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
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
function run(ref: string, state: DispatchBoardRoadRun['state']): DispatchBoardRoadRun {
  return {
    roadRunId: '11111111-1111-4111-8111-' + ref.replace(/[^0-9a-f]/gi, '').padStart(12, '0').slice(-12),
    state,
    assignedOperatorId: 'op-1',
    assignedAssetId: 'truck-7',
    driverName: null,
    vehiclePlate: null,
    plannedStartAt: '2026-05-30T08:00:00.000Z',
    stopCount: 1,
    transportOrderRefs: [ref],
    customerName: null,
    customerPhone: null,
    cargoName: null,
    weightDiffKg: null,
    stops: [],
  };
}

describe('@fleet/ops-web - DispatchView pagination + status filter (L1)', () => {
  it('renders Active/Finished filter tabs with Active current by default', () => {
    render(<DispatchView
      initialRuns={[run('XTT.06-001', 'planned')]}
      refs={refs}
      pagination={{ group: 'active', page: 1, pageSize: 20, total: 1, totalPages: 1, hasMore: false }}
    />);
    const active = screen.getByTestId('dispatch-board-filter-active');
    const finished = screen.getByTestId('dispatch-board-filter-finished');
    expect(active).toBeTruthy();
    expect(finished).toBeTruthy();
    // Active is the current view.
    expect(active.getAttribute('aria-current')).toBe('page');
    // Finished tab links to the finished group via URL state.
    expect(finished.getAttribute('href')).toContain('group=finished');
    // Cancelled tab (Lenh Huy) exists and links to the cancelled group via URL state.
    const cancelled = screen.getByTestId('dispatch-board-filter-cancelled');
    expect(cancelled).toBeTruthy();
    expect(cancelled.getAttribute('href')).toContain('group=cancelled');
  });

  it('renders a bottom pagination control with a total count and a jump-to-page search input', () => {
    render(<DispatchView
      initialRuns={[run('XTT.06-001', 'planned')]}
      refs={refs}
      pagination={{ group: 'active', page: 1, pageSize: 2, total: 5, totalPages: 3, hasMore: true }}
    />);
    const pager = screen.getByTestId('dispatch-board-pagination');
    expect(pager).toBeTruthy();
    // Total count reflects the envelope total.
    expect(screen.getByTestId('dispatch-board-total-count').textContent).toContain('5');
    // Jump-to-page search input present.
    expect(screen.getByTestId('dispatch-board-page-search')).toBeTruthy();
    // Numbered page links for each of the 3 pages, inside the pager.
    const p2 = within(pager).getByTestId('dispatch-board-page-link-2');
    expect(p2.getAttribute('href')).toContain('page=2');
    expect(within(pager).getByTestId('dispatch-board-page-link-3')).toBeTruthy();
  });

  it('marks the Finished tab current and preserves group in page links when group=finished', () => {
    render(<DispatchView
      initialRuns={[run('XTT.05-001', 'cancelled')]}
      refs={refs}
      pagination={{ group: 'finished', page: 1, pageSize: 2, total: 3, totalPages: 2, hasMore: true }}
    />);
    expect(screen.getByTestId('dispatch-board-filter-finished').getAttribute('aria-current')).toBe('page');
    const p2 = screen.getByTestId('dispatch-board-page-link-2');
    expect(p2.getAttribute('href')).toContain('group=finished');
    expect(p2.getAttribute('href')).toContain('page=2');
  });

  it('marks the Lenh Huy (cancelled) tab current and preserves group in page links when group=cancelled', () => {
    render(<DispatchView
      initialRuns={[run('XTT.05-002', 'cancelled')]}
      refs={refs}
      pagination={{ group: 'cancelled', page: 1, pageSize: 2, total: 3, totalPages: 2, hasMore: true }}
    />);
    expect(screen.getByTestId('dispatch-board-filter-cancelled').getAttribute('aria-current')).toBe('page');
    const p2 = screen.getByTestId('dispatch-board-page-link-2');
    expect(p2.getAttribute('href')).toContain('group=cancelled');
    expect(p2.getAttribute('href')).toContain('page=2');
  });
});
