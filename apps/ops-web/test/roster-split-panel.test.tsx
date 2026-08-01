// apps/ops-web/test/roster-split-panel.test.tsx
// outside-in strict TDD RED: the dispatched-vs-idle panel at the top of the
// Bảng điều phối xe page - two tables side by side.
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
import { RosterSplitPanel } from '@/features/dispatch/RosterSplitPanel';
import type { DispatchRosterSplit } from '@fleet/sync-protocol';

const SPLIT: DispatchRosterSplit = {
  day: '2026-08-01',
  asOf: '2026-08-01T05:00:00.000Z',
  totalDrivers: 4,
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
    expect(screen.getByTestId('roster-split-dispatched-count').textContent).toBe('1');
    expect(screen.getByTestId('roster-split-idle-count').textContent).toBe('3');
  });

  it('shows the roster total so a dropped driver would be visible', () => {
    render(<RosterSplitPanel split={SPLIT} />);
    expect(screen.getByTestId('roster-split-total').textContent).toBe('4');
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
    const noTruckRow = screen.getByTestId('roster-split-idle-row-33333333-3333-4333-8333-333333333333');
    expect(within(noTruckRow).getByText('-')).toBeTruthy();
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
