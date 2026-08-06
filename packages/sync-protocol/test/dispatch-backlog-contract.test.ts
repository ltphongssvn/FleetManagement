// packages/sync-protocol/test/dispatch-backlog-contract.test.ts
// RED-first WIRE contract test (M1) for the dispatch backlog counters.
//
// Business problem: dispatchers still phone drivers over Zalo, so transport
// order records live half in ops-web and half in manual Excel. The board must
// show at a glance, for the current Asia/Ho_Chi_Minh day: how many customer
// orders were entered, how many were dispatched through the app, and how many
// are still waiting for a driver.
//
// PACKAGE BOUNDARY: @fleet/sync-protocol depends on zod ONLY -- it carries no
// edge to @fleet/domain, by design (see dispatch-stop-view-contract.ts, which
// mirrors road-run vocabulary rather than importing it). So the state->bucket
// classification lives in @fleet/domain beside TRANSPORT_ORDER_STATES, and this
// file covers only the wire shape the API emits and ops-web parses.
//
// Read-path contract => z.object strip mode + a lenient parse helper that
// returns null and never throws, per context/schema-first-zod-contracts.md.
import { describe, expect, it } from 'vitest';
import {
  DispatchBacklogCountsSchema,
  parseDispatchBacklogCounts,
  type DispatchBacklogCounts,
} from '../src/dispatch-backlog-contract.js';

const valid = {
  total: 12,
  dispatched: 5,
  pending: 7,
  day: '2026-07-30',
  asOf: '2026-07-30T09:15:00.000Z',
};

describe('DispatchBacklogCountsSchema', () => {
  it('accepts a consistent snapshot', () => {
    expect(DispatchBacklogCountsSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a snapshot whose parts do not sum to the total', () => {
    expect(DispatchBacklogCountsSchema.safeParse({ ...valid, total: 99 }).success).toBe(false);
  });

  it('rejects negative counts', () => {
    expect(DispatchBacklogCountsSchema.safeParse({ ...valid, pending: -1 }).success).toBe(false);
  });

  it('rejects fractional counts', () => {
    expect(DispatchBacklogCountsSchema.safeParse({ ...valid, pending: 6.5 }).success).toBe(false);
  });

  it('rejects a day that is not YYYY-MM-DD', () => {
    expect(DispatchBacklogCountsSchema.safeParse({ ...valid, day: '30/07/2026' }).success).toBe(false);
  });

  it('rejects a non ISO-8601 asOf instant', () => {
    expect(DispatchBacklogCountsSchema.safeParse({ ...valid, asOf: 'now' }).success).toBe(false);
  });

  it('accepts an all-zero day before any order is entered', () => {
    const empty = { ...valid, total: 0, dispatched: 0, pending: 0 };
    expect(DispatchBacklogCountsSchema.safeParse(empty).success).toBe(true);
  });

  it('strips unknown keys rather than failing (strip mode, forward compatible)', () => {
    const parsed = DispatchBacklogCountsSchema.safeParse({ ...valid, surprise: 1 });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('surprise' in parsed.data).toBe(false);
    }
  });
});

describe('parseDispatchBacklogCounts', () => {
  it('returns null instead of throwing on a malformed payload', () => {
    expect(parseDispatchBacklogCounts({ total: 'many' })).toBeNull();
  });

  it('returns null on a payload whose parts contradict the total', () => {
    expect(parseDispatchBacklogCounts({ ...valid, dispatched: 4 })).toBeNull();
  });

  it('returns the parsed value on a good payload', () => {
    const parsed: DispatchBacklogCounts | null = parseDispatchBacklogCounts(valid);
    expect(parsed?.pending).toBe(7);
    expect(parsed?.day).toBe('2026-07-30');
  });
});
