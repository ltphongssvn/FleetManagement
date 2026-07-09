// packages/sync-protocol/test/owner-adoption-contract.test.ts
// RED: owner adoption dashboard wire contract (schema-first SSOT).
// Funnel counts derived server-side from driver + device_registry:
// total -> deviceRegistered (any row) -> appInstalled (real appVersion)
// -> activeToday (lastSeenAt within VN-local day). Read path => strip
// mode object + lenient parse helper (null, never throw).
import { describe, expect, it } from 'vitest';
import {
  OwnerAdoptionMetricsSchema,
  parseOwnerAdoptionMetrics,
} from '../src/owner-adoption-contract.js';

const valid = {
  totalDrivers: 5,
  deviceRegistered: 4,
  appInstalled: 3,
  activeToday: 2,
  notInstalled: 2,
  asOf: '2026-07-06T08:00:00.000Z',
  day: '2026-07-06',
};

describe('OwnerAdoptionMetricsSchema', () => {
  it('accepts a valid payload', () => {
    const r = OwnerAdoptionMetricsSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it('strips unknown keys (strip-mode read contract)', () => {
    const r = OwnerAdoptionMetricsSchema.safeParse({ ...valid, extra: 'x' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect('extra' in r.data).toBe(false);
    }
  });

  it('rejects negative counts', () => {
    const r = OwnerAdoptionMetricsSchema.safeParse({ ...valid, appInstalled: -1 });
    expect(r.success).toBe(false);
  });

  it('rejects non-integer counts', () => {
    const r = OwnerAdoptionMetricsSchema.safeParse({ ...valid, totalDrivers: 1.5 });
    expect(r.success).toBe(false);
  });

  it('rejects a missing field', () => {
    const { activeToday, ...rest } = valid;
    void activeToday;
    const r = OwnerAdoptionMetricsSchema.safeParse(rest);
    expect(r.success).toBe(false);
  });

  it('rejects a malformed day (must be YYYY-MM-DD)', () => {
    const r = OwnerAdoptionMetricsSchema.safeParse({ ...valid, day: '06/07/2026' });
    expect(r.success).toBe(false);
  });

  it('rejects a malformed asOf (must be ISO datetime)', () => {
    const r = OwnerAdoptionMetricsSchema.safeParse({ ...valid, asOf: 'yesterday' });
    expect(r.success).toBe(false);
  });
});

describe('parseOwnerAdoptionMetrics', () => {
  it('returns typed data for a valid payload', () => {
    const m = parseOwnerAdoptionMetrics(valid);
    expect(m).not.toBeNull();
    expect(m?.activeToday).toBe(2);
  });

  it('returns null (never throws) for garbage', () => {
    expect(parseOwnerAdoptionMetrics('nope')).toBeNull();
    expect(parseOwnerAdoptionMetrics(null)).toBeNull();
    expect(parseOwnerAdoptionMetrics({ totalDrivers: 'five' })).toBeNull();
  });
});
