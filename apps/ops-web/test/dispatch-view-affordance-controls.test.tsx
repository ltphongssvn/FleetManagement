// apps/ops-web/test/dispatch-view-affordance-controls.test.tsx
// The T70 controls, ACTUALLY ACTIVATED.
//
// WHY THIS EXISTS. UX-08/09/06 added visible submit controls to replace an
// invisible Enter-only contract: a Tim button beside the search box, a Di
// button beside the page-jump input, and a call-to-action inside the empty
// board. dispatch-view-affordance.test.tsx asserts they RENDER; nothing ever
// clicked them. Function coverage on DispatchView therefore sat at 85% and the
// pre-push gate refused the push.
//
// The gap is not academic for these handlers specifically. Their entire reason
// for existing is that the previous interaction was undiscoverable -- so a test
// that renders the button but never activates it verifies precisely the half
// that was never broken. The uncovered functions ARE the fix.
//
// Navigation is asserted through window.location.assign, which the component
// uses deliberately (the plain-anchor escape hatch documented in the file
// header: router.push drives the vercel/next.js#57565 stuck-prefetch loop).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DispatchView, type DispatchBoardPagination } from '@/features/dispatch/DispatchView';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

const REFS = {
  drivers: [],
  vehicles: [],
  customers: [],
  cargoTypes: [],
  pickupWarehouses: [],
  deliveryWarehouses: [],
  driverVehicleAssignments: [],
} as never;

const PAGINATION: DispatchBoardPagination = {
  group: 'active',
  page: 1,
  pageSize: 20,
  total: 40,
  totalPages: 2,
  hasMore: true,
};

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assign = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign, href: 'http://localhost/' },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SearchBox - the visible submit control (UX-09)', () => {
  it('navigates when the Tim button is pressed, not only on Enter', async () => {
    const user = userEvent.setup();
    render(<DispatchView initialRuns={[]} refs={REFS} pagination={PAGINATION} />);
    await user.type(screen.getByTestId('dispatch-board-search'), 'CHAU');
    await user.click(screen.getByTestId('dispatch-board-search-submit'));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(String(assign.mock.calls[0]?.[0])).toContain('search=CHAU');
  });

  it('returns to the unfiltered board when the native clear empties an active search', async () => {
    const user = userEvent.setup();
    render(
      <DispatchView initialRuns={[]} refs={REFS} pagination={PAGINATION} searchTerm='CHAU' />,
    );
    await user.clear(screen.getByTestId('dispatch-board-search'));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(String(assign.mock.calls[0]?.[0])).not.toContain('search=');
  });

  it('does NOT navigate when clearing an already-unfiltered board', async () => {
    const user = userEvent.setup();
    render(<DispatchView initialRuns={[]} refs={REFS} pagination={PAGINATION} />);
    await user.clear(screen.getByTestId('dispatch-board-search'));
    expect(assign).not.toHaveBeenCalled();
  });
});

describe('PaginationBar - the visible jump control (UX-08)', () => {
  it('navigates to the typed page when Di is pressed', async () => {
    const user = userEvent.setup();
    render(<DispatchView initialRuns={[]} refs={REFS} pagination={PAGINATION} />);
    const input = screen.getByTestId('dispatch-board-page-search');
    await user.clear(input);
    await user.type(input, '2');
    await user.click(screen.getByTestId('dispatch-board-page-go'));
    expect(String(assign.mock.calls[0]?.[0])).toContain('page=2');
  });

  it('clamps a page beyond the last one instead of navigating nowhere', async () => {
    const user = userEvent.setup();
    render(<DispatchView initialRuns={[]} refs={REFS} pagination={PAGINATION} />);
    const input = screen.getByTestId('dispatch-board-page-search');
    await user.clear(input);
    await user.type(input, '99');
    await user.click(screen.getByTestId('dispatch-board-page-go'));
    expect(String(assign.mock.calls[0]?.[0])).toContain('page=2');
  });

  it('treats an emptied jump box as page 1 rather than navigating nowhere', async () => {
    // Number('') is 0, NOT NaN -- so an emptied input is finite and clamps to
    // the first page. That is the sane reading of a cleared box, and asserting
    // a NaN guard here would have been asserting a branch this path cannot
    // reach. The real non-finite guard is covered below.
    const user = userEvent.setup();
    render(<DispatchView initialRuns={[]} refs={REFS} pagination={PAGINATION} />);
    await user.clear(screen.getByTestId('dispatch-board-page-search'));
    await user.click(screen.getByTestId('dispatch-board-page-go'));
    expect(String(assign.mock.calls[0]?.[0])).toContain('page=1');
  });

  it('clamps a below-range page up to 1', async () => {
    const user = userEvent.setup();
    render(<DispatchView initialRuns={[]} refs={REFS} pagination={PAGINATION} />);
    const input = screen.getByTestId('dispatch-board-page-search');
    await user.clear(input);
    await user.type(input, '-5');
    await user.click(screen.getByTestId('dispatch-board-page-go'));
    expect(String(assign.mock.calls[0]?.[0])).toContain('page=1');
  });
});

describe('Empty board - the in-place next step (UX-06)', () => {
  it('opens the create drawer from the empty-state CTA', async () => {
    const user = userEvent.setup();
    render(<DispatchView initialRuns={[]} refs={REFS} />);
    await user.click(screen.getByTestId('dispatch-board-empty-cta'));
    expect(screen.getByTestId('close-create-order')).toBeInTheDocument();
  });

  it('offers no CTA when the board is empty because nothing MATCHED', () => {
    render(<DispatchView initialRuns={[]} refs={REFS} pagination={PAGINATION} searchTerm='zzz' />);
    expect(screen.queryByTestId('dispatch-board-empty-cta')).toBeNull();
  });
});

describe('Create drawer - open and close', () => {
  it('closes again from the Dong button', async () => {
    const user = userEvent.setup();
    render(<DispatchView initialRuns={[]} refs={REFS} />);
    await user.click(screen.getByTestId('open-create-order'));
    await user.click(screen.getByTestId('close-create-order'));
    expect(screen.queryByTestId('close-create-order')).toBeNull();
  });
});
