// packages/sync-protocol/test/vn-date-format.test.ts
// RED spec (t65 Vietnamese-date-format arc, Phase 4). Outside-in: this file is
// written BEFORE src/vn-date-format.ts exists, so the first run must fail on
// the missing module -- proof the test is exercising new behaviour and not
// passing vacuously against something already present.
//
// WHAT IS PINNED HERE, AND WHY EACH CASE EXISTS.
//
// 1. Shape. Every human-facing date renders dd/MM/yyyy. The defect this arc
//    removes is Intl month: short under en-US / en-GB, which produced
//    Jul 19, 2026 on a Vietnamese-only dispatch board.
//
// 2. Timezone. The instants below are chosen to straddle the Asia/Ho_Chi_Minh
//    (UTC+7) day boundary. 2026-07-19T17:30Z is already 2026-07-20 00:30 in
//    Vietnam, and 2026-07-19T16:59Z is still 2026-07-19 23:59. A formatter
//    that omits timeZone (the shipped DispatchView PLANNED_FORMATTER did) or
//    that reads the host zone will render the WRONG CALENDAR DAY for one of
//    them on a UTC host, so these two cases are the real correctness test --
//    not cosmetics.
//
// 3. Purity across render environments. The same input must produce the same
//    output in an RSC server render and in the client hydration render.
//    Pinning the zone in the contract is what makes that true; asserting both
//    boundary instants is how we detect a regression to ambient state.
//
// 4. Missing data. A null or unparseable instant renders the shared em-dash
//    fallback, never the string Invalid Date and never a silent empty cell.
import { describe, expect, it } from 'vitest';
import {
  VN_DATE_FALLBACK,
  VN_LONG_DAY_WORD,
  VN_LONG_MONTH_WORD,
  VN_LONG_YEAR_WORD,
  isVnDateString,
  isVnDateTimeString,
  vnDateStringSchema,
  vnDateTimeStringSchema,
} from '../src/vn-date-format-contract.js';
import {
  formatVnDate,
  formatVnDateTime,
  formatVnDateLong,
} from '../src/vn-date-format.js';

// 17:30Z on 19 Jul is 00:30 on 20 Jul in Vietnam: the day ROLLS OVER.
const AFTER_VN_MIDNIGHT = '2026-07-19T17:30:00.000Z';
// 16:59Z on 19 Jul is 23:59 on 19 Jul in Vietnam: the day has NOT rolled over.
const BEFORE_VN_MIDNIGHT = '2026-07-19T16:59:00.000Z';
// A plain mid-morning Vietnam instant, no boundary involved.
const MID_MORNING = '2026-07-19T01:05:00.000Z';

describe('formatVnDate', () => {
  it('renders an ISO instant as dd/MM/yyyy', () => {
    expect(formatVnDate(MID_MORNING)).toBe('19/07/2026');
  });

  it('accepts a Date instance as well as an ISO string', () => {
    expect(formatVnDate(new Date(MID_MORNING))).toBe('19/07/2026');
  });

  it('rolls the calendar day over at Asia/Ho_Chi_Minh midnight, not UTC midnight', () => {
    expect(formatVnDate(AFTER_VN_MIDNIGHT)).toBe('20/07/2026');
  });

  it('does not roll the day over before Asia/Ho_Chi_Minh midnight', () => {
    expect(formatVnDate(BEFORE_VN_MIDNIGHT)).toBe('19/07/2026');
  });

  it('pads single-digit days and months to two digits', () => {
    expect(formatVnDate('2026-03-05T04:00:00.000Z')).toBe('05/03/2026');
  });

  it('never emits an English month abbreviation', () => {
    const rendered = formatVnDate(MID_MORNING);
    expect(rendered.includes('Jul')).toBe(false);
    expect(rendered.includes('thg')).toBe(false);
  });

  it('satisfies the contract predicate and schema', () => {
    const rendered = formatVnDate(MID_MORNING);
    expect(isVnDateString(rendered)).toBe(true);
    expect(vnDateStringSchema.safeParse(rendered).success).toBe(true);
  });

  it('renders the shared fallback for null', () => {
    expect(formatVnDate(null)).toBe(VN_DATE_FALLBACK);
  });

  it('renders the shared fallback for an unparseable instant', () => {
    expect(formatVnDate('not-a-date')).toBe(VN_DATE_FALLBACK);
  });
});

describe('formatVnDateTime', () => {
  it('renders dd/MM/yyyy HH:mm on a 24-hour clock in Vietnam local time', () => {
    expect(formatVnDateTime(AFTER_VN_MIDNIGHT)).toBe('20/07/2026 00:30');
  });

  it('keeps the late-evening instant on the same Vietnamese day', () => {
    expect(formatVnDateTime(BEFORE_VN_MIDNIGHT)).toBe('19/07/2026 23:59');
  });

  it('never emits an AM or PM marker', () => {
    const rendered = formatVnDateTime(MID_MORNING);
    expect(rendered.includes('AM')).toBe(false);
    expect(rendered.includes('PM')).toBe(false);
  });

  it('satisfies the contract predicate and schema', () => {
    const rendered = formatVnDateTime(MID_MORNING);
    expect(isVnDateTimeString(rendered)).toBe(true);
    expect(vnDateTimeStringSchema.safeParse(rendered).success).toBe(true);
  });

  it('renders the shared fallback for null', () => {
    expect(formatVnDateTime(null)).toBe(VN_DATE_FALLBACK);
  });
});

describe('formatVnDateLong', () => {
  it('renders the formal Vietnamese document form from the contract vocabulary', () => {
    const expected = VN_LONG_DAY_WORD + '20' + VN_LONG_MONTH_WORD + '07' + VN_LONG_YEAR_WORD + '2026';
    expect(formatVnDateLong(AFTER_VN_MIDNIGHT)).toBe(expected);
  });

  it('spells the Vietnamese words with their diacritics', () => {
    const rendered = formatVnDateLong(MID_MORNING);
    expect(rendered.startsWith('Ngày ')).toBe(true);
    expect(rendered.includes(' tháng ')).toBe(true);
    expect(rendered.includes(' năm ')).toBe(true);
  });

  it('renders the shared fallback for null', () => {
    expect(formatVnDateLong(null)).toBe(VN_DATE_FALLBACK);
  });
});
