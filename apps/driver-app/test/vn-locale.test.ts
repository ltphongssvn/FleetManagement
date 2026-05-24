// apps/driver-app/test/vn-locale.test.ts
// TDD RED: centralized VN locale/timezone formatting. Backend runs on
// Railway (US/SG); drivers + dispatchers operate in Vietnam. Server sends
// UTC ISO timestamps; the UI must always render in Asia/Ho_Chi_Minh (UTC+7)
// with vi-VN conventions, regardless of device timezone/locale.
import { describe, it, expect } from 'vitest';
import {
  VN_TIME_ZONE,
  formatVnDateTime,
  formatVnDate,
  formatVnNumber,
} from '../src/config/vn-locale.js';

describe('vn-locale', () => {
  it('exposes the Vietnam IANA zone', () => {
    expect(VN_TIME_ZONE).toBe('Asia/Ho_Chi_Minh');
  });

  it('renders a UTC instant in UTC+7 (not device tz)', () => {
    // 2026-01-15T03:30:00Z == 10:30 the same day in Ho Chi Minh (UTC+7).
    const out = formatVnDateTime('2026-01-15T03:30:00Z');
    expect(out).toMatch(/10:30/);
    expect(out).toMatch(/15/);
    expect(out).toMatch(/01|thg 1|tháng 1/i);
  });

  it('rolls the date forward when UTC+7 crosses midnight', () => {
    // 2026-01-15T18:00:00Z == 2026-01-16 01:00 in HCMC.
    const out = formatVnDateTime('2026-01-15T18:00:00Z');
    expect(out).toMatch(/16/);
  });

  it('formatVnDate returns date only (no time)', () => {
    const out = formatVnDate('2026-01-15T18:00:00Z');
    expect(out).toMatch(/16/);
    expect(out).not.toMatch(/:/);
  });

  it('accepts a Date object as well as an ISO string', () => {
    const out = formatVnDateTime(new Date('2026-01-15T03:30:00Z'));
    expect(out).toMatch(/10:30/);
  });

  it('formats numbers with vi-VN grouping', () => {
    expect(formatVnNumber(1234567)).toBe('1.234.567');
  });

  it('returns a stable fallback for an invalid date', () => {
    expect(formatVnDateTime('not-a-date')).toBe('—');
    expect(formatVnDate('')).toBe('—');
  });
});
