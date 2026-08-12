// packages/domain/src/transport/vn-day-window.ts
// SINGLE SOURCE OF TRUTH for what TODAY means in this system: the
// Asia/Ho_Chi_Minh calendar day and its half-open [startUtc, endUtc) window.
//
// The pilot is VN-local. UTC day boundaries misattribute evening activity: a
// dispatch created at 23:30 Vietnam time is already the NEXT UTC day, so a
// naive UTC slice would show the owner an empty morning board and file the
// run under tomorrow. Every today question - owner adoption metrics, the
// dispatched-vs-idle roster split - must resolve through THIS module so two
// screens can never disagree about the same day.
//
// VN is a fixed UTC+7 offset with NO daylight saving, so VN midnight is
// exactly 00:00:00+07:00 on the calendar date and the window is a plain 24h
// span. That is why the start can be built by string offset rather than by
// zone arithmetic.
export const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const DAY_MS = 24 * 60 * 60 * 1000;

// en-CA emits ISO order (YYYY-MM-DD); combined with timeZone this yields the
// VN-local calendar date with no manual offset arithmetic.
const VN_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: VN_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD of the instant in Asia/Ho_Chi_Minh. */
export function vnDayOf(instant: Date): string {
  return VN_YMD.format(instant);
}

/** The VN calendar day containing an instant, plus its UTC window bounds. */
export interface VnDayWindow {
  /** YYYY-MM-DD in Asia/Ho_Chi_Minh. */
  readonly day: string;
  /** VN midnight of that day, as a UTC instant. INCLUSIVE bound. */
  readonly startUtc: Date;
  /** VN midnight of the following day, as a UTC instant. EXCLUSIVE bound. */
  readonly endUtc: Date;
}

/**
 * Half-open [startUtc, endUtc) window of the VN calendar day containing the
 * instant. Half-open (not inclusive-inclusive) so consecutive days tile the
 * timeline with no overlap and no gap: an event at exactly endUtc belongs to
 * the NEXT day, never to both.
 */
export function vnDayWindowUtc(instant: Date): VnDayWindow {
  const day = vnDayOf(instant);
  const startUtc = new Date(day + 'T00:00:00.000+07:00');
  const endUtc = new Date(startUtc.getTime() + DAY_MS);
  return { day, startUtc, endUtc };
}
