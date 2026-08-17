// packages/domain/test/vn-day-window.test.ts
// RED: SSOT for the Asia/Ho_Chi_Minh calendar-day window.
//
// WHY THIS IS EXTRACTED, NOT COPIED. The VN day window already existed as a
// PRIVATE helper inside apps/api/src/owner/owner-metrics.service.ts. The
// dispatched-vs-idle roster split needs the same rule (which drivers ran
// TODAY in Vietnam). Two private copies of what today means is exactly the
// drift this codebase forbids: an owner metric and an owner panel disagreeing
// about the day boundary would be invisible until the boss saw two different
// answers on the same screen. So the rule moves into @fleet/domain and both
// consumers import ONE definition.
//
// VN is a fixed UTC+7 offset with no daylight saving, so VN midnight is
// exactly 00:00:00+07:00 on the given calendar date and the window is a plain
// 24h span. The tests pin the boundary cases that a naive UTC slice gets
// wrong: 17:00 UTC is already the NEXT day in Vietnam.
import { describe, it, expect } from 'vitest';
import { VN_TIME_ZONE, vnDayOf, vnDayWindowUtc } from '../src/transport/vn-day-window.js';

describe('@fleet/domain - VN calendar day window', () => {
  it('exposes the Asia/Ho_Chi_Minh zone as the SSOT constant', () => {
    expect(VN_TIME_ZONE).toBe('Asia/Ho_Chi_Minh');
  });

  it('formats a midday UTC instant to the same VN calendar day', () => {
    expect(vnDayOf(new Date('2026-08-01T05:00:00.000Z'))).toBe('2026-08-01');
  });

  it('rolls to the NEXT VN day for a late-evening UTC instant', () => {
    // 18:00 UTC = 01:00 the next day in VN (UTC+7).
    expect(vnDayOf(new Date('2026-07-31T18:00:00.000Z'))).toBe('2026-08-01');
  });

  it('keeps the PREVIOUS VN day for an instant just before VN midnight', () => {
    // 16:30 UTC = 23:30 the same VN day.
    expect(vnDayOf(new Date('2026-07-31T16:30:00.000Z'))).toBe('2026-07-31');
  });

  it('returns a window whose start is VN midnight expressed in UTC', () => {
    const w = vnDayWindowUtc(new Date('2026-08-01T05:00:00.000Z'));
    expect(w.day).toBe('2026-08-01');
    // VN midnight 2026-08-01T00:00+07:00 === 2026-07-31T17:00Z
    expect(w.startUtc.toISOString()).toBe('2026-07-31T17:00:00.000Z');
  });

  it('returns an end exactly 24 hours after the start (half-open window)', () => {
    const w = vnDayWindowUtc(new Date('2026-08-01T05:00:00.000Z'));
    expect(w.endUtc.getTime() - w.startUtc.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(w.endUtc.toISOString()).toBe('2026-08-01T17:00:00.000Z');
  });

  it('places an instant at the exact window start INSIDE the window', () => {
    const w = vnDayWindowUtc(new Date('2026-08-01T05:00:00.000Z'));
    const atStart = new Date(w.startUtc.getTime());
    expect(atStart >= w.startUtc && atStart < w.endUtc).toBe(true);
  });

  it('places an instant at the exact window end OUTSIDE the window', () => {
    const w = vnDayWindowUtc(new Date('2026-08-01T05:00:00.000Z'));
    const atEnd = new Date(w.endUtc.getTime());
    expect(atEnd >= w.startUtc && atEnd < w.endUtc).toBe(false);
  });

  it('agrees with vnDayOf on which day the window belongs to', () => {
    const instant = new Date('2026-07-31T18:00:00.000Z');
    expect(vnDayWindowUtc(instant).day).toBe(vnDayOf(instant));
  });

  it('handles a month boundary without off-by-one', () => {
    // 17:30 UTC on 31 Jul = 00:30 VN on 01 Aug.
    const w = vnDayWindowUtc(new Date('2026-07-31T17:30:00.000Z'));
    expect(w.day).toBe('2026-08-01');
    expect(w.startUtc.toISOString()).toBe('2026-07-31T17:00:00.000Z');
  });
});
