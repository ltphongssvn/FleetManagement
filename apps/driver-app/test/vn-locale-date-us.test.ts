// apps/driver-app/test/vn-locale-date-us.test.ts
// outside-in strict TDD RED (L0): driver-app assignment dates render date-only
// in en-US 'MMM D, YYYY' form (e.g. May 30, 2026), consistent with ops-web.
// Underlying datetime + HCMC-tz logic unchanged; only the displayed string
// changes (no time, en-US month name).
import { describe, it, expect } from 'vitest';
import { formatVnDateUS } from '../src/config/vn-locale.js';
describe('formatVnDateUS', () => {
  it('renders date only in en-US MMM D, YYYY (HCMC tz), no time', () => {
    // 2026-05-30T07:12:00Z == 14:12 same day in HCMC (UTC+7).
    const out = formatVnDateUS('2026-05-30T07:12:00Z');
    expect(out).toBe('May 30, 2026');
    expect(out).not.toMatch(/:/);
  });
  it('rolls the date forward when UTC+7 crosses midnight', () => {
    // 2026-05-30T18:00:00Z == 2026-05-31 01:00 in HCMC.
    expect(formatVnDateUS('2026-05-30T18:00:00Z')).toBe('May 31, 2026');
  });
  it('returns the stable fallback for an invalid date', () => {
    expect(formatVnDateUS('not-a-date')).toBe('—');
  });
});
