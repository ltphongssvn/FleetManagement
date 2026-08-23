// apps/ops-web/test/roster-split-panel.test.tsx
// The dispatched-vs-idle panel at the top of the Bảng điều phối xe page - two
// tables side by side.
//
// WHAT THE OWNER MUST SEE IN ONE GLANCE. Left: drivers on the road today with
// their truck. Right: drivers staying home with an idle truck. The right table
// is the one he acts on - a name there is either a real efficiency question or
// a dispatcher who sent the job over Zalo so it never entered the app. That is
// why the idle table shows a REASON per row: no_vehicle_assigned means the
// driver COULD NOT be dispatched, no_dispatch_today means he could have been
// and was not.
//
// COUNTS ARE PART OF THE GLANCE. Each heading carries its count so the owner
// never has to tally rows, and the panel shows the roster total so a dropped
// driver would be visible as a mismatch rather than silently absent.
//
// Vietnamese strings asserted here are IMMUTABLE production UI contracts, with
// full diacritics - the reader is a Vietnamese owner, and once shipped these
// strings are frozen.
//
// textContent is read WITHOUT a ?? fallback: getAllByRole returns HTMLElement,
// whose textContent TypeScript already knows is non-null in this position, so a
// guard is dead code and no-unnecessary-condition rejects it.
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RosterSplitPanel } from '@/features/dispatch/RosterSplitPanel';
import type { DispatchRosterSplit } from '@fleet/sync-protocol';

const SPLIT: DispatchRosterSplit = {
  day: '2026-08-01',
  asOf: '2026-08-01T05:00:00.000Z',
  totalDrivers: 5,
  dispatched: [
    {
      driverId: '11111111-1111-4111-8111-111111111111',
      driverName: 'LÊ VĂN CHÂU',
      vehiclePlate: '51A-11111',
      roadRunId: '99999999-9999-4999-8999-999999999999',
      state: 'dispatched',
      plannedStartAt: '2026-08-01T01:00:00.000Z',
      orderRefs: ['XTT.08-001'],
    },
    {
      // ON THE ROAD but with NO truck recorded on the run and no order refs
      // yet. Both are real states: a run can be created before the asset is
      // attached, and refs land when the transport order is linked. The panel
      // must still show him as working, with a dash rather than a blank cell -
      // a blank reads to the owner as a rendering fault.
      driverId: '55555555-5555-4555-8555-555555555555',
      driverName: 'HOÀNG VĂN NĂM',
      vehiclePlate: null,
      roadRunId: '88888888-8888-4888-8888-888888888888',
      state: 'planned',
      plannedStartAt: null,
      orderRefs: [],
    },
  ],
  idle: [
    {
      driverId: '22222222-2222-4222-8222-222222222222',
      driverName: 'NGUYỄN VĂN MẪU',
      vehiclePlate: '51A-22222',
      reason: 'no_dispatch_today',
    },
    {
      driverId: '33333333-3333-4333-8333-333333333333',
      driverName: 'TRẦN VĂN BA',
      vehiclePlate: null,
      reason: 'no_vehicle_assigned',
    },
    {
      driverId: '44444444-4444-4444-8444-444444444444',
      driverName: 'PHẠM VĂN TƯ',
      vehiclePlate: '51A-44444',
      reason: 'no_dispatch_today',
    },
  ],
};

const EMPTY: DispatchRosterSplit = {
  day: '2026-08-01',
  asOf: '2026-08-01T05:00:00.000Z',
  totalDrivers: 0,
  dispatched: [],
  idle: [],
};

// A roster big enough to page: 12 idle drivers at 5 per page = 3 pages. Built
// rather than hand-written so the arithmetic in the assertions is obvious
// (driver N is IDLE-N) and a page-size change cannot silently pass.
function idleRow(n: number): DispatchRosterSplit['idle'][number] {
  return {
    driverId: 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(n).padStart(12, '0'),
    driverName: 'IDLE-' + String(n),
    vehiclePlate: '51A-' + String(n).padStart(5, '0'),
    reason: 'no_dispatch_today',
  };
}
const BIG: DispatchRosterSplit = {
  day: '2026-08-01',
  asOf: '2026-08-01T05:00:00.000Z',
  totalDrivers: 12,
  dispatched: [],
  idle: Array.from({ length: 12 }, (_, i) => idleRow(i + 1)),
};

describe('RosterSplitPanel', () => {
  it('renders both tables with the immutable Vietnamese headings', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    expect(screen.getByTestId('roster-split-dispatched')).toBeTruthy();
    expect(screen.getByTestId('roster-split-idle')).toBeTruthy();
    // Each phrase appears twice BY DESIGN: once in the visible h3 heading and
    // once in the visually-hidden caption naming the table for screen readers.
    // Assert the HEADING specifically rather than relaxing to getAllByText,
    // which would still pass if the visible heading disappeared entirely.
    const headings = screen.getAllByRole('heading', { level: 3 });
    const headingText = headings.map((el) => el.textContent);
    expect(headingText.some((x) => x.includes('Tài xế đang chạy hôm nay'))).toBe(true);
    expect(headingText.some((x) => x.includes('Tài xế ở nhà hôm nay'))).toBe(true);
  });

  it('names each table with a visually hidden caption for screen readers', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    const left = within(screen.getByTestId('roster-split-dispatched'));
    const right = within(screen.getByTestId('roster-split-idle'));
    expect(left.getByText('Danh sách tài xế đang chạy hôm nay')).toBeTruthy();
    expect(right.getByText('Danh sách tài xế ở nhà hôm nay')).toBeTruthy();
  });

  it('shows the count on each heading so the owner never tallies rows', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    expect(screen.getByTestId('roster-split-dispatched-count').textContent).toBe('2');
    expect(screen.getByTestId('roster-split-idle-count').textContent).toBe('3');
  });

  it('shows the roster total so a dropped driver would be visible', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    expect(screen.getByTestId('roster-split-total').textContent).toBe('5');
  });

  it('lists every dispatched driver with a plate in the LEFT table only', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    const left = within(screen.getByTestId('roster-split-dispatched'));
    expect(left.getByText('LÊ VĂN CHÂU')).toBeTruthy();
    expect(left.getByText('51A-11111')).toBeTruthy();
    const right = within(screen.getByTestId('roster-split-idle'));
    expect(right.queryByText('LÊ VĂN CHÂU')).toBeNull();
  });

  it('lists every idle driver in the RIGHT table only', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    const right = within(screen.getByTestId('roster-split-idle'));
    expect(right.getByText('NGUYỄN VĂN MẪU')).toBeTruthy();
    expect(right.getByText('TRẦN VĂN BA')).toBeTruthy();
    expect(right.getByText('PHẠM VĂN TƯ')).toBeTruthy();
    const left = within(screen.getByTestId('roster-split-dispatched'));
    expect(left.queryByText('NGUYỄN VĂN MẪU')).toBeNull();
  });

  it('renders a distinct Vietnamese label per idle reason', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    const right = within(screen.getByTestId('roster-split-idle'));
    expect(right.getAllByText('Chưa điều xe hôm nay')).toHaveLength(2);
    expect(right.getAllByText('Chưa gắn xe')).toHaveLength(1);
  });

  it('renders a dash for an idle driver with no assigned truck', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    const noTruckRow = screen.getByTestId(
      'roster-split-idle-row-33333333-3333-4333-8333-333333333333',
    );
    expect(within(noTruckRow).getByText('-')).toBeTruthy();
  });

  it('renders a dash for a dispatched driver with no truck and no order refs', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    const row = screen.getByTestId(
      'roster-split-dispatched-row-55555555-5555-4555-8555-555555555555',
    );
    // Two dashes: the plate cell and the order-ref cell. A blank cell would
    // read as a rendering fault; a dash reads as known-empty.
    expect(within(row).getAllByText('-')).toHaveLength(2);
    expect(within(row).getByText('HOÀNG VĂN NĂM')).toBeTruthy();
  });

  it('renders empty states for both tables when nobody is on the roster', () => {
    render(<RosterSplitPanel split={EMPTY} />);
    expect(screen.getByTestId('roster-split-dispatched-empty')).toBeTruthy();
    expect(screen.getByTestId('roster-split-idle-empty')).toBeTruthy();
  });

  it('renders exactly two tables, side by side', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });

  it('renders each driver name as a row header for screen readers', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    const rowHeaders = screen.getAllByRole('rowheader');
    expect(rowHeaders.map((el) => el.textContent)).toContain('LÊ VĂN CHÂU');
    expect(rowHeaders.map((el) => el.textContent)).toContain('TRẦN VĂN BA');
  });

  it('warns visibly when the split does not partition the roster', () => {
    const broken: DispatchRosterSplit = { ...SPLIT, totalDrivers: 22 };
    render(<RosterSplitPanel split={broken} />);
    expect(screen.getByTestId('roster-split-partition-warning')).toBeTruthy();
  });

  it('shows no partition warning when the split is consistent', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    expect(screen.queryByTestId('roster-split-partition-warning')).toBeNull();
  });
});

// PAGINATION (2026). 29 real drivers rendered unpaginated pushed the Lệnh điều
// xe board entirely below the fold, which DEFEATS the glance goal the panel
// exists for. Five rows per table keeps both columns and the board on one
// screen. Page changes are discrete, user-triggered events, which is exactly
// what makes pagination the accessible choice over virtual scrolling.
describe('RosterSplitPanel pagination', () => {
  it('shows no pagination controls when a table fits on one page', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    expect(screen.queryByTestId('roster-split-idle-pagination')).toBeNull();
    expect(screen.queryByTestId('roster-split-dispatched-pagination')).toBeNull();
  });

  it('renders at most five driver rows per page', () => {
    render(<RosterSplitPanel split={BIG} />);
    const rows = within(screen.getByTestId('roster-split-idle')).getAllByRole('rowheader');
    expect(rows).toHaveLength(5);
    expect(rows.map((el) => el.textContent)).toEqual([
      'IDLE-1',
      'IDLE-2',
      'IDLE-3',
      'IDLE-4',
      'IDLE-5',
    ]);
  });

  // THE COUNT IS THE WHOLE POINT OF THE PANEL. It must keep reporting the FULL
  // roster, never the visible page: an owner who reads 5 when 12 drivers are
  // home has been actively misinformed by the pagination.
  it('keeps the heading count at the FULL roster size, not the page size', () => {
    render(<RosterSplitPanel split={BIG} />);
    expect(screen.getByTestId('roster-split-idle-count').textContent).toBe('12');
    expect(screen.getByTestId('roster-split-total').textContent).toBe('12');
  });

  it('still validates the partition against ALL rows, not the visible page', () => {
    render(<RosterSplitPanel split={BIG} />);
    expect(screen.queryByTestId('roster-split-partition-warning')).toBeNull();
  });

  it('wraps the controls in a nav named for THAT table (two tables, two navs)', () => {
    render(<RosterSplitPanel split={BIG} />);
    const nav = screen.getByTestId('roster-split-idle-pagination');
    expect(nav.tagName).toBe('NAV');
    expect(nav.getAttribute('aria-label')).toBe('Phân trang tài xế ở nhà hôm nay');
  });

  it('marks the current page with aria-current so it is announced', () => {
    render(<RosterSplitPanel split={BIG} />);
    const nav = within(screen.getByTestId('roster-split-idle-pagination'));
    expect(nav.getByRole('button', { name: 'Trang 1' }).getAttribute('aria-current')).toBe('page');
    expect(nav.getByRole('button', { name: 'Trang 2' }).getAttribute('aria-current')).toBeNull();
  });

  it('navigates to a clicked page number', async () => {
    const user = userEvent.setup();
    render(<RosterSplitPanel split={BIG} />);
    const nav = within(screen.getByTestId('roster-split-idle-pagination'));
    await user.click(nav.getByRole('button', { name: 'Trang 3' }));
    const rows = within(screen.getByTestId('roster-split-idle')).getAllByRole('rowheader');
    expect(rows.map((el) => el.textContent)).toEqual(['IDLE-11', 'IDLE-12']);
  });

  it('announces the visible range in a polite live region', async () => {
    const user = userEvent.setup();
    render(<RosterSplitPanel split={BIG} />);
    const status = screen.getByTestId('roster-split-idle-status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Hiển thị 1-5 trên 12 tài xế');
    const nav = within(screen.getByTestId('roster-split-idle-pagination'));
    await user.click(nav.getByRole('button', { name: 'Trang 2' }));
    expect(status.textContent).toBe('Hiển thị 6-10 trên 12 tài xế');
  });

  // Each table pages on its OWN state. Sharing one page index would move the
  // dispatched table when the owner pages the idle one - two independent
  // questions answered by one control is a lie about the data.
  it('pages each table independently', async () => {
    const user = userEvent.setup();
    const both: DispatchRosterSplit = {
      ...BIG,
      totalDrivers: 24,
      dispatched: Array.from({ length: 12 }, (_, i) => ({
        driverId: 'bbbbbbbb-bbbb-4bbb-8bbb-' + String(i + 1).padStart(12, '0'),
        driverName: 'RUN-' + String(i + 1),
        vehiclePlate: null,
        roadRunId: 'cccccccc-cccc-4ccc-8ccc-' + String(i + 1).padStart(12, '0'),
        state: 'dispatched' as const,
        plannedStartAt: null,
        orderRefs: [],
      })),
    };
    render(<RosterSplitPanel split={both} />);
    const idleNav = within(screen.getByTestId('roster-split-idle-pagination'));
    await user.click(idleNav.getByRole('button', { name: 'Trang 2' }));
    const dispatchedRows = within(screen.getByTestId('roster-split-dispatched')).getAllByRole(
      'rowheader',
    );
    expect(dispatchedRows[0]?.textContent).toBe('RUN-1');
  });

  it('renders one page button per page and no more', () => {
    render(<RosterSplitPanel split={BIG} />);
    const nav = within(screen.getByTestId('roster-split-idle-pagination'));
    expect(nav.getAllByRole('button')).toHaveLength(3);
  });
});
