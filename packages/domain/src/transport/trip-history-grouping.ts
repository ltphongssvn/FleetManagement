// packages/domain/src/transport/trip-history-grouping.ts
// Single source of truth for bucketing completed trips into calendar months
// in Asia/Ho_Chi_Minh time. Shared by the API trip-history endpoint and the
// driver app so web and mobile never disagree on which month a trip belongs
// to — a trip completed late at night in Vietnam can fall on the next UTC
// day, so naive UTC slicing would misfile it.
//
// Generic over the row type: callers pass accessors for the run state and the
// completedAt ISO timestamp, so both the API row shape and the driver-app
// AssignmentRow can reuse this without the domain package importing either.
const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const VN_LOCALE = 'vi-VN';
// 'en-CA' yields ISO-like 'YYYY-MM-DD'; with timeZone this gives the VN-local
// calendar date with no manual offset arithmetic.
const VN_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: VN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const VN_MONTH_LABEL = new Intl.DateTimeFormat(VN_LOCALE, {
  timeZone: VN_TIME_ZONE,
  year: 'numeric',
  month: 'short',
});
export interface TripMonthGroup<T> {
  // 'YYYY-MM' in VN time — stable grouping + sort key.
  readonly monthKey: string;
  // Human label, e.g. 'Thg 3 2026' (vi-VN).
  readonly label: string;
  // Number of completed trips in the month.
  readonly count: number;
  // The completed trips, newest completion first.
  readonly trips: readonly T[];
}
function vnMonthKey(d: Date): string {
  return VN_YMD.format(d).slice(0, 7);
}
// Groups completed trips by VN-timezone month. A row is included only when
// getState(row) is 'completed' (case-insensitive) and getCompletedAt(row) is
// a parseable ISO timestamp. Months are ordered newest-first; trips within a
// month are ordered newest-completion-first.
export function groupCompletedTripsByMonth<T>(
  rows: readonly T[],
  getState: (row: T) => string,
  getCompletedAt: (row: T) => string | null,
): readonly TripMonthGroup<T>[] {
  const buckets = new Map<string, { label: string; entries: { row: T; completedAt: string }[] }>();
  for (const row of rows) {
    if (getState(row).toLowerCase() !== 'completed') continue;
    const completedAt = getCompletedAt(row);
    if (completedAt === null) continue;
    const d = new Date(completedAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = vnMonthKey(d);
    const bucket = buckets.get(key) ?? { label: VN_MONTH_LABEL.format(d), entries: [] };
    bucket.entries.push({ row, completedAt });
    buckets.set(key, bucket);
  }
  const months: TripMonthGroup<T>[] = [];
  for (const [monthKey, bucket] of buckets) {
    // Newest completion first within the month.
    const sorted = [...bucket.entries].sort((a, b) => {
      if (a.completedAt < b.completedAt) return 1;
      if (a.completedAt > b.completedAt) return -1;
      return 0;
    });
    months.push({
      monthKey,
      label: bucket.label,
      count: sorted.length,
      trips: sorted.map((e) => e.row),
    });
  }
  // Newest month first. monthKey values come from Map keys, so they are
  // unique by construction — the equal branch below is unreachable in
  // practice and excluded from coverage rather than tested with an
  // impossible input.
  months.sort((a, b) => {
    if (a.monthKey < b.monthKey) return 1;
    if (a.monthKey > b.monthKey) return -1;
    /* v8 ignore next -- unreachable: Map guarantees unique monthKey values */
    return 0;
  });
  return months;
}
