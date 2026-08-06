// apps/driver-app/test/vn-locale-date-us.test.ts
// outside-in strict TDD RED (t65 Vietnamese-date-format arc): the driver app
// renders assignment dates in pure Vietnamese, dd/MM/yyyy.
//
// This file previously pinned formatVnDateUS to the en-US MMM D, YYYY form and
// justified it as being consistent with ops-web. That consistency argument is
// now inverted: ops-web has moved to the shared @fleet/sync-protocol formatter,
// so an en-US driver-app date would be the lone outlier -- and drivers are the
// users least likely to read an English month abbreviation at a weighbridge.
//
// The function is deliberately KEPT under its existing name rather than deleted
// in the same step. Renaming an exported symbol and changing its behaviour at
// once would make a regression ambiguous between the two changes; the rename is
// a separate mechanical follow-up. Its US suffix is now a misnomer, and the
// implementation comment says so.
//
// The Asia/Ho_Chi_Minh boundary case from the original spec is preserved,
// because that is the one assertion here that tests correctness rather than
// presentation.
import { describe, it, expect } from 'vitest';
import { isVnDateString } from '@fleet/sync-protocol';
import { formatVnDateUS } from '../src/config/vn-locale.js';
describe('formatVnDateUS renders a pure Vietnamese date', () => {
  it('renders dd/MM/yyyy in Asia/Ho_Chi_Minh, with no time', () => {
    // 2026-05-30T07:12:00Z == 14:12 the same day in Vietnam (UTC+7).
    const out = formatVnDateUS('2026-05-30T07:12:00Z');
    expect(out).toBe('30/05/2026');
  });
  it('never renders an English month abbreviation', () => {
    expect(formatVnDateUS('2026-05-30T07:12:00Z')).not.toContain('May');
  });
  it('satisfies the shared Vietnamese date contract predicate', () => {
    expect(isVnDateString(formatVnDateUS('2026-05-30T07:12:00Z'))).toBe(true);
  });
  it('rolls the date forward when UTC+7 crosses midnight', () => {
    // 2026-05-30T18:00:00Z == 2026-05-31 01:00 in Vietnam.
    expect(formatVnDateUS('2026-05-30T18:00:00Z')).toBe('31/05/2026');
  });
  it('accepts a Date instance as well as an ISO string', () => {
    expect(formatVnDateUS(new Date('2026-05-30T07:12:00Z'))).toBe('30/05/2026');
  });
  it('returns the stable em-dash fallback for an invalid date', () => {
    expect(formatVnDateUS('not-a-date')).toBe('\u2014');
  });
});
