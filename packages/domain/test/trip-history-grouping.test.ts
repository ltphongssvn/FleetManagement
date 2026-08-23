// packages/domain/test/trip-history-grouping.test.ts
// TDD RED: groupCompletedTripsByMonth is the single source of truth for
// bucketing completed trips into Asia/Ho_Chi_Minh calendar months, shared by
// the API trip-history endpoint and the driver app so web and mobile never
// disagree on which month a late-night completion belongs to. It is generic
// over the row type: callers supply state + completedAt accessors.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  groupCompletedTripsByMonth,
  type TripMonthGroup,
} from '../src/transport/trip-history-grouping.js';
interface Row {
  readonly id: string;
  readonly state: string;
  readonly completedAt: string | null;
}
function mk(partial: Partial<Row>): Row {
  return { id: 'r', state: 'completed', completedAt: null, ...partial };
}
const group = (rows: readonly Row[]): readonly TripMonthGroup<Row>[] =>
  groupCompletedTripsByMonth(
    rows,
    (r) => r.state,
    (r) => r.completedAt,
  );
describe('groupCompletedTripsByMonth', () => {
  it('returns no months for an empty list', () => {
    expect(group([])).toEqual([]);
  });
  it('excludes runs whose state is not completed', () => {
    const rows = [
      mk({ id: 'a', state: 'planned', completedAt: '2026-03-10T02:00:00.000Z' }),
      mk({ id: 'b', state: 'started', completedAt: '2026-03-11T02:00:00.000Z' }),
    ];
    expect(group(rows)).toEqual([]);
  });
  it('excludes a completed run with no completedAt timestamp', () => {
    expect(group([mk({ id: 'a', state: 'completed', completedAt: null })])).toEqual([]);
  });
  it('excludes a completed run with an unparseable completedAt', () => {
    expect(group([mk({ id: 'a', completedAt: 'not-a-date' })])).toEqual([]);
  });
  it('groups completed runs by month and counts them', () => {
    const rows = [
      mk({ id: 'a', completedAt: '2026-03-02T03:00:00.000Z' }),
      mk({ id: 'b', completedAt: '2026-03-20T03:00:00.000Z' }),
      mk({ id: 'c', completedAt: '2026-02-15T03:00:00.000Z' }),
    ];
    const months = group(rows);
    expect(months).toHaveLength(2);
    expect(months[0]?.monthKey).toBe('2026-03');
    expect(months[0]?.count).toBe(2);
    expect(months[1]?.monthKey).toBe('2026-02');
    expect(months[1]?.count).toBe(1);
  });
  it('orders months newest first and trips within a month newest first', () => {
    const rows = [
      mk({ id: 'jan', completedAt: '2026-01-05T03:00:00.000Z' }),
      mk({ id: 'mar-early', completedAt: '2026-03-03T03:00:00.000Z' }),
      mk({ id: 'mar-late', completedAt: '2026-03-28T03:00:00.000Z' }),
    ];
    const months = group(rows);
    expect(months.map((m) => m.monthKey)).toEqual(['2026-03', '2026-01']);
    expect(months[0]?.trips.map((t) => t.id)).toEqual(['mar-late', 'mar-early']);
  });
  it('buckets by VN timezone, not UTC (late-night UTC rolls into VN next month)', () => {
    // 2026-02-28T18:30Z is 2026-03-01 01:30 in Asia/Ho_Chi_Minh (UTC+7).
    expect(group([mk({ id: 'x', completedAt: '2026-02-28T18:30:00.000Z' })])[0]?.monthKey).toBe(
      '2026-03',
    );
  });
  it('each month carries a human vi-VN label', () => {
    const months = group([mk({ id: 'a', completedAt: '2026-03-10T03:00:00.000Z' })]);
    expect(months[0]?.label).toContain('2026');
    expect(months[0]?.label.toLowerCase()).toContain('thg');
  });
  it('keeps both trips when two completions share the exact same timestamp', () => {
    // Exercises the equal branch of the within-month completedAt comparator.
    const ts = '2026-03-10T03:00:00.000Z';
    const rows = [mk({ id: 'tie-a', completedAt: ts }), mk({ id: 'tie-b', completedAt: ts })];
    const months = group(rows);
    expect(months).toHaveLength(1);
    expect(months[0]?.count).toBe(2);
    expect(months[0]?.trips.map((t) => t.id).sort()).toEqual(['tie-a', 'tie-b']);
  });
  it('is case-insensitive on the state value', () => {
    expect(
      group([mk({ id: 'a', state: 'COMPLETED', completedAt: '2026-03-10T03:00:00.000Z' })]),
    ).toHaveLength(1);
  });
});
describe('groupCompletedTripsByMonth - property-based invariants', () => {
  const stateArb = fc.constantFrom('planned', 'dispatched', 'started', 'completed');
  const completedAtArb = fc.option(
    fc
      .date({
        min: new Date('2020-01-01T00:00:00.000Z'),
        max: new Date('2030-12-31T23:59:59.000Z'),
      })
      .filter((d) => !Number.isNaN(d.getTime()))
      .map((d) => d.toISOString()),
    { nil: null },
  );
  const rowArb: fc.Arbitrary<Row> = fc.record({
    id: fc.uuid(),
    state: stateArb,
    completedAt: completedAtArb,
  });
  it('every grouped trip is completed with a non-null completedAt', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 60 }), (rows) => {
        for (const m of group(rows)) {
          for (const t of m.trips) {
            expect(t.state.toLowerCase()).toBe('completed');
            expect(t.completedAt).not.toBeNull();
          }
        }
      }),
    );
  });
  it('total grouped trips never exceeds input length; count matches trips.length', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 60 }), (rows) => {
        const months = group(rows);
        const total = months.reduce((s, m) => s + m.trips.length, 0);
        expect(total).toBeLessThanOrEqual(rows.length);
        for (const m of months) expect(m.count).toBe(m.trips.length);
      }),
    );
  });
  it('months are strictly ordered newest-first by monthKey', () => {
    fc.assert(
      fc.property(fc.array(rowArb, { maxLength: 60 }), (rows) => {
        const keys = group(rows).map((m) => m.monthKey);
        const sorted = [...keys].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
        expect(keys).toEqual(sorted);
      }),
    );
  });
});
