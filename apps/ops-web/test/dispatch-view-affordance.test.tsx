// apps/ops-web/test/dispatch-view-affordance.test.tsx
// RED-first for T70 slice 3: the Bang dieu phoi board.
//
// Closes ledger defects UX-01, UX-02, UX-03, UX-06, UX-07, UX-08, UX-09,
// UX-10 and UX-11 from context/t70-ux-affordance-overhaul-plan.md. Each case
// below names the defect it closes so a future reader can trace a test back to
// the reported complaint rather than to a style opinion.
//
// Contracts this file must NOT break (asserted elsewhere on origin/develop, so
// they are load-bearing): the open-create-order testid, the three
// dispatch-board-filter-* testids and their aria-current=page, the
// dispatch-board-search and dispatch-board-page-search testids, and the empty
// board text Chua co lenh dieu xe nao. This slice ADDS affordances around them.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HELP_TOPIC_VI, EMPTY_STATE_VI, MIN_TARGET_SIZE_PX } from '@fleet/domain';
import type { DispatchBoardRoadRun } from '../src/features/dispatch/types';

afterEach(cleanup);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
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

const pagination = {
  group: 'active' as const,
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 3,
  hasMore: true,
};

const row: DispatchBoardRoadRun = {
  roadRunId: 'rr-1',
  // ROAD_RUN_STATES SSOT member. in_progress is NOT in the vocabulary --
  // the in-flight member is started -- and typecheck rejected the invented
  // value, which is the two-axis contract doing its job on a test fixture.
  state: 'started',
  assignedOperatorId: 'op-1',
  assignedAssetId: 'veh-1',
  driverName: 'LÊ TRUNG THÀNH',
  vehiclePlate: '62H 06120',
  plannedStartAt: null,
  stopCount: 2,
  transportOrderRefs: ['XTT.07-048'],
  customerName: 'TÂN KỲ NGUYÊN',
  customerPhone: null,
  cargoName: 'TRẤU',
  weightDiffKg: null,
  stops: [],
};

const px = (n: number): string => String(n) + 'px';

describe('board help affordance (UX-01)', () => {
  it('mounts the shared help mechanism for the dispatch_board topic', () => {
    // WCAG 3.2.6 Consistent Help. Before this slice the product had NO help
    // affordance on any surface, so a user who did not already know the
    // workflow had nowhere to look.
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    expect(screen.getByTestId('help-trigger-dispatch_board')).toBeTruthy();
  });

  it('reveals the board guidance steps on demand', async () => {
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    await userEvent.click(screen.getByTestId('help-trigger-dispatch_board'));
    expect(screen.getByText(HELP_TOPIC_VI.dispatch_board.title)).toBeTruthy();
    for (const step of HELP_TOPIC_VI.dispatch_board.steps) {
      expect(screen.getByText(step)).toBeTruthy();
    }
  });
});

describe('primary action prominence (UX-02, UX-11)', () => {
  it('renders the create trigger through the Button primitive as the sole solid primary action', () => {
    // The toolbar previously gave the search box, three filter pills, the
    // create button, the export button and a date range equal visual weight.
    // Exactly one solid primary action per surface is what makes it findable.
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    const create = screen.getByTestId('open-create-order');
    expect(create.getAttribute('data-tone')).toBe('primary');
    expect(create.getAttribute('data-emphasis')).toBe('solid');
    const solidPrimary = document.querySelectorAll('[data-tone=primary][data-emphasis=solid]');
    expect(solidPrimary).toHaveLength(1);
  });

  it('gives the create trigger the WCAG 2.5.8 minimum hit area', () => {
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    const create = screen.getByTestId('open-create-order');
    expect(create.style.minHeight).toBe(px(MIN_TARGET_SIZE_PX));
    expect(create.style.minWidth).toBe(px(MIN_TARGET_SIZE_PX));
  });

  it('keeps the board heading out of the control cluster so the title cannot wrap around the search box', () => {
    // UX-02: the h1 and the toolbar shared one flex row, so the title broke
    // across three lines around the search input at common widths.
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    const heading = screen.getByRole('heading', { name: /^L.nh .i.u xe$/i });
    const toolbar = screen.getByTestId('dispatch-board-toolbar');
    expect(toolbar.contains(heading)).toBe(false);
  });
});

describe('filter tabs use the tab pattern (UX-07)', () => {
  it('marks each filter as a tab inside the tablist', () => {
    // The controls sat in a role=tablist but were plain anchors using
    // aria-current=page, so assistive technology got a mismatched model.
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    const active = screen.getByTestId('dispatch-board-filter-active');
    expect(active.getAttribute('role')).toBe('tab');
    expect(active.getAttribute('aria-selected')).toBe('true');
    const finished = screen.getByTestId('dispatch-board-filter-finished');
    expect(finished.getAttribute('role')).toBe('tab');
    expect(finished.getAttribute('aria-selected')).toBe('false');
  });

  it('preserves the existing aria-current contract', () => {
    // Load-bearing on origin/develop: dispatch-view-pagination and
    // dispatch-view-search both assert aria-current=page. Adding the tab
    // semantics must not remove it.
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    expect(screen.getByTestId('dispatch-board-filter-active').getAttribute('aria-current')).toBe('page');
  });

  it('gives every filter tab the minimum hit area', () => {
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    for (const id of ['active', 'finished', 'cancelled']) {
      const tab = screen.getByTestId('dispatch-board-filter-' + id);
      expect(tab.style.minHeight).toBe(px(MIN_TARGET_SIZE_PX));
    }
  });
});

describe('search submits visibly (UX-09)', () => {
  it('offers a submit control instead of a hidden Enter-only contract', () => {
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    expect(screen.getByTestId('dispatch-board-search-submit')).toBeTruthy();
  });

  it('labels the search box visibly rather than by placeholder alone', () => {
    // WCAG 3.3.2: a placeholder disappears on the first keystroke.
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    const box = screen.getByTestId('dispatch-board-search');
    expect(box.getAttribute('aria-describedby')).toBe('dispatch-board-search-hint');
    expect(document.getElementById('dispatch-board-search-hint')).not.toBeNull();
  });
});

describe('page jump submits visibly (UX-08)', () => {
  it('offers a go control next to the page number input', () => {
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    expect(screen.getByTestId('dispatch-board-page-go')).toBeTruthy();
  });
});

describe('empty board explains itself and offers the next step (UX-06)', () => {
  it('renders the SSOT empty-state copy as a status region', () => {
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    const empty = screen.getByTestId('dispatch-board-empty');
    expect(empty.getAttribute('role')).toBe('status');
    expect(screen.getByText(EMPTY_STATE_VI.no_data_yet.title)).toBeTruthy();
    expect(screen.getByText(EMPTY_STATE_VI.no_data_yet.hint)).toBeTruthy();
  });

  it('opens the create drawer from the empty-state call to action', () => {
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} />);
    fireEvent.click(screen.getByTestId('dispatch-board-empty-cta'));
    expect(document.querySelector('form[data-testid=nl-create-order-form]')).not.toBeNull();
  });

  it('distinguishes an empty SEARCH from an empty board', () => {
    // UX-03 in miniature: no results because you filtered is a different
    // situation, with a different remedy, from no data exists yet.
    render(<DispatchView initialRuns={[]} refs={refs} pagination={pagination} searchTerm='khong-co' />);
    expect(screen.getByTestId('dispatch-board-empty').getAttribute('data-reason')).toBe('no_search_results');
    expect(screen.getByText(EMPTY_STATE_VI.no_search_results.hint)).toBeTruthy();
  });
});

describe('rows advertise that they are navigable (UX-10)', () => {
  it('gives each data row a hover affordance', () => {
    render(<DispatchView initialRuns={[row]} refs={refs} pagination={pagination} />);
    const tr = screen.getByTestId('dispatch-board-rr-rr-1');
    expect(tr.className).toContain('hover:bg');
  });
});

describe('the em-dash is explained rather than overloaded (UX-03)', () => {
  it('names why the weight difference is blank', () => {
    // The same glyph meant no data, no stop, not applicable and incomplete
    // reconciliation across four columns, with no legend anywhere.
    render(<DispatchView initialRuns={[row]} refs={refs} pagination={pagination} />);
    const cell = screen.getByTestId('dispatch-board-weightdiff-XTT.07-048');
    expect(cell.getAttribute('title')).toBe(EMPTY_STATE_VI.awaiting_upstream.hint);
    expect(cell.getAttribute('aria-label')).toBe(EMPTY_STATE_VI.awaiting_upstream.title);
  });
});
