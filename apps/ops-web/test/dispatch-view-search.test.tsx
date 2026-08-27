// apps/ops-web/test/dispatch-view-search.test.tsx
// L1: the Lenh dieu xe board search box. When given a pagination prop the board
// renders a free-text search input (dispatch-board-search) reflecting the current
// searchTerm; pressing Enter navigates (full-nav escape hatch) to ?search= at page
// 1 of the current group, preserving the group; a non-Enter key does NOT navigate;
// an empty term navigates WITHOUT the search param. Tabs/page links preserve the
// active search term. Navigation is window.location.assign (spied), matching the
// pagination jump-to-page pattern.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DispatchView } from '@/features/dispatch/DispatchView';
import type { DispatchBoardRoadRun } from '@/features/dispatch/types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const refs = {
  drivers: [{ id: 'op-1', label: 'NGUYEN THANH PHONG' }],
  vehicles: [{ id: 'truck-7', label: '62H 05194' }],
  customers: [],
  cargoTypes: [],
  pickupWarehouses: [],
  deliveryWarehouses: [],
  driverVehicleAssignments: [],
};

function run(ref: string, state: DispatchBoardRoadRun['state']): DispatchBoardRoadRun {
  return {
    roadRunId: '11111111-1111-4111-8111-000000000001',
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

const PAG = {
  group: 'active' as const,
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
  hasMore: false,
};

type AssignFn = (url: string | URL) => void;
// Typed vi.fn (NOT vi.spyOn, whose return collapses to any under the strict
// eslint config -> no-unsafe-*). Redefine window.location with an explicit
// object exposing only the props the component reads (assign + href), so no
// Location class instance is spread (no-misused-spread). Restored by afterEach.
function spyAssign(): ReturnType<typeof vi.fn<AssignFn>> {
  const fn = vi.fn<AssignFn>();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign: fn, href: 'http://localhost/' },
  });
  return fn;
}

describe('@fleet/ops-web - DispatchView search box (L1)', () => {
  it('renders the search input reflecting the current searchTerm', () => {
    render(
      <DispatchView
        initialRuns={[run('XTT.06-001', 'planned')]}
        refs={refs}
        pagination={PAG}
        searchTerm={'chau'}
      />,
    );
    const box = screen.getByTestId<HTMLInputElement>('dispatch-board-search');
    expect(box).toBeTruthy();
    expect(box.value).toBe('chau');
  });

  it('Enter navigates to ?search= at page 1 of the current group', () => {
    const assign = spyAssign();
    render(
      <DispatchView initialRuns={[run('XTT.06-001', 'planned')]} refs={refs} pagination={PAG} />,
    );
    const box = screen.getByTestId('dispatch-board-search');
    fireEvent.change(box, { target: { value: 'chau' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(assign).toHaveBeenCalledTimes(1);
    const call0 = assign.mock.calls[0];
    expect(call0).toBeDefined();
    const url = String(call0?.[0]);
    expect(url).toContain('search=chau');
    expect(url).toContain('group=active');
    expect(url).toContain('page=1');
  });

  it('a non-Enter key does not navigate', () => {
    const assign = spyAssign();
    render(
      <DispatchView initialRuns={[run('XTT.06-001', 'planned')]} refs={refs} pagination={PAG} />,
    );
    const box = screen.getByTestId('dispatch-board-search');
    fireEvent.change(box, { target: { value: 'chau' } });
    fireEvent.keyDown(box, { key: 'a' });
    expect(assign).not.toHaveBeenCalled();
  });

  it('an empty term navigates without the search param', () => {
    const assign = spyAssign();
    render(
      <DispatchView
        initialRuns={[run('XTT.06-001', 'planned')]}
        refs={refs}
        pagination={PAG}
        searchTerm={'chau'}
      />,
    );
    const box = screen.getByTestId('dispatch-board-search');
    fireEvent.change(box, { target: { value: '   ' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(assign).toHaveBeenCalledTimes(1);
    const emptyCall = assign.mock.calls[0];
    expect(emptyCall).toBeDefined();
    expect(String(emptyCall?.[0])).not.toContain('search=');
  });

  it('clearing the box (native clear -> empty change event) navigates without search when a term was active', () => {
    const assign = spyAssign();
    render(
      <DispatchView
        initialRuns={[run('XTT.06-001', 'planned')]}
        refs={refs}
        pagination={PAG}
        searchTerm={'chau'}
      />,
    );
    const box = screen.getByTestId('dispatch-board-search');
    // The native X clear fires an input event with an empty value and NO Enter
    // keydown. The board must return to the unfiltered view.
    fireEvent.change(box, { target: { value: '' } });
    expect(assign).toHaveBeenCalledTimes(1);
    const cleared = assign.mock.calls[0];
    expect(cleared).toBeDefined();
    const url = String(cleared?.[0]);
    expect(url).not.toContain('search=');
    expect(url).toContain('group=active');
    expect(url).toContain('page=1');
  });

  it('a non-empty change event does not navigate (typing does not trigger navigation)', () => {
    const assign = spyAssign();
    render(
      <DispatchView
        initialRuns={[run('XTT.06-001', 'planned')]}
        refs={refs}
        pagination={PAG}
        searchTerm={'chau'}
      />,
    );
    const box = screen.getByTestId('dispatch-board-search');
    fireEvent.change(box, { target: { value: 'cha' } });
    expect(assign).not.toHaveBeenCalled();
  });

  it('tab and page links preserve the active search term', () => {
    render(
      <DispatchView
        initialRuns={[run('XTT.06-001', 'planned')]}
        refs={refs}
        pagination={{
          group: 'active',
          page: 1,
          pageSize: 2,
          total: 5,
          totalPages: 3,
          hasMore: true,
        }}
        searchTerm={'chau'}
      />,
    );
    expect(screen.getByTestId('dispatch-board-filter-finished').getAttribute('href')).toContain(
      'search=chau',
    );
    expect(screen.getByTestId('dispatch-board-page-link-2').getAttribute('href')).toContain(
      'search=chau',
    );
  });
});
