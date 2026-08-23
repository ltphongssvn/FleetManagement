// packages/sync-protocol/test/transport-order-export-contract.test.ts
// Contract tests for the Excel export day-range (Feature 4). The schema is the
// SSOT the API controller validates query params against; these pin the
// accept/reject behavior (format, from<=to, no stray keys).
import { describe, it, expect } from 'vitest';
import {
  exportDayKeySchema,
  ExportDateRangeSchema,
} from '../src/transport-order-export-contract.js';

describe('exportDayKeySchema', () => {
  it('accepts a YYYY-MM-DD date', () => {
    expect(exportDayKeySchema.parse('2026-05-24')).toBe('2026-05-24');
  });
  it('rejects a non-date string (kills regex removal)', () => {
    expect(exportDayKeySchema.safeParse('24/05/2026').success).toBe(false);
  });
  it('rejects an empty string', () => {
    expect(exportDayKeySchema.safeParse('').success).toBe(false);
  });
});

describe('ExportDateRangeSchema', () => {
  it('accepts a well-formed inclusive range', () => {
    expect(ExportDateRangeSchema.parse({ from: '2026-05-01', to: '2026-05-31' })).toEqual({
      from: '2026-05-01',
      to: '2026-05-31',
    });
  });
  it('accepts a single-day range (from === to)', () => {
    expect(ExportDateRangeSchema.parse({ from: '2026-05-24', to: '2026-05-24' }).from).toBe(
      '2026-05-24',
    );
  });
  it('rejects an inverted range (from > to) — kills .refine() removal', () => {
    expect(ExportDateRangeSchema.safeParse({ from: '2026-05-31', to: '2026-05-01' }).success).toBe(
      false,
    );
  });
  it('rejects a malformed date in the range', () => {
    expect(ExportDateRangeSchema.safeParse({ from: '2026-5-1', to: '2026-05-31' }).success).toBe(
      false,
    );
  });
  it('rejects stray keys (.strict())', () => {
    expect(
      ExportDateRangeSchema.safeParse({ from: '2026-05-01', to: '2026-05-31', extra: 1 }).success,
    ).toBe(false);
  });
});
