// packages/sync-protocol/test/dispatch-board-pagination-contract.test.ts
// Contract tests (RED-first, now GREEN) for the Lệnh điều xe board pagination +
// active/finished partition feature. Pins the SSOT the API validates query
// params against, the envelope ops-web parses, and — crucially — the
// state->group PARTITION as a regression guard.
//
// Partition lockstep (mirrors the ROAD_RUN_STATES / CANCEL_REASONS inlining
// pattern in this zod-only package): the SSOT is @fleet/domain roadRunFsm whose
// terminal set is ['completed','cancelled']. This package takes NO @fleet/*
// runtime dep, so we do NOT import @fleet/domain; instead the source inlines
// ROAD_RUN_TERMINAL_STATES and we assert the partition is exhaustive + disjoint
// over the canonical inlined ROAD_RUN_STATES (source-tracking: if a new road-run
// state is added to ROAD_RUN_STATES, the union assertion fails until the new
// state is classified, and the value assertions fail if the terminal set drifts
// from the domain). If @fleet/domain's terminal set changes, update the source's
// inlined ROAD_RUN_TERMINAL_STATES to match.
import { describe, it, expect } from 'vitest';
import {
  ROAD_RUN_STATUS_GROUPS,
  roadRunStatusGroupSchema,
  statesForStatusGroup,
  RoadRunPageQuerySchema,
  makePaginatedResponseSchema,
} from '../src/dispatch-board-pagination-contract.js';
import { ROAD_RUN_STATES } from '../src/dispatch-stop-view-contract.js';
import { z } from 'zod';

describe('roadRunStatusGroupSchema', () => {
  it('exposes exactly active + finished groups', () => {
    expect([...ROAD_RUN_STATUS_GROUPS]).toEqual(['active', 'finished']);
  });
  it('accepts active and finished', () => {
    expect(roadRunStatusGroupSchema.parse('active')).toBe('active');
    expect(roadRunStatusGroupSchema.parse('finished')).toBe('finished');
  });
  it('rejects an unknown group (kills enum removal)', () => {
    expect(roadRunStatusGroupSchema.safeParse('done').success).toBe(false);
  });
});

describe('statesForStatusGroup (partition lockstep guard)', () => {
  it('maps active -> the three non-terminal states', () => {
    expect([...statesForStatusGroup('active')].sort()).toEqual(['dispatched', 'planned', 'started']);
  });
  it('maps finished -> the two terminal states (lockstep with @fleet/domain terminal set)', () => {
    expect([...statesForStatusGroup('finished')].sort()).toEqual(['cancelled', 'completed']);
  });
  it('partition exactly covers canonical ROAD_RUN_STATES — exhaustive + disjoint, source-tracking', () => {
    const union = [...statesForStatusGroup('active'), ...statesForStatusGroup('finished')].sort();
    expect(union).toEqual([...ROAD_RUN_STATES].sort());
    const overlap = statesForStatusGroup('active').filter((s) => statesForStatusGroup('finished').includes(s));
    expect(overlap).toEqual([]);
  });
});

describe('RoadRunPageQuerySchema', () => {
  it('defaults group=active, page=1, pageSize=20 on empty input', () => {
    expect(RoadRunPageQuerySchema.parse({})).toEqual({ group: 'active', page: 1, pageSize: 20 });
  });
  it('coerces numeric query strings (page/pageSize arrive as strings)', () => {
    expect(RoadRunPageQuerySchema.parse({ page: '3', pageSize: '50' })).toMatchObject({ page: 3, pageSize: 50 });
  });
  it('rejects page < 1 (kills positive() removal)', () => {
    expect(RoadRunPageQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });
  it('rejects pageSize over the server cap of 100 (kills max() removal)', () => {
    expect(RoadRunPageQuerySchema.safeParse({ pageSize: '101' }).success).toBe(false);
  });
  it('accepts an optional search term', () => {
    expect(RoadRunPageQuerySchema.parse({ search: 'XTT.06' }).search).toBe('XTT.06');
  });
  it('rejects stray keys (.strict())', () => {
    expect(RoadRunPageQuerySchema.safeParse({ group: 'active', bogus: 1 }).success).toBe(false);
  });
});

describe('makePaginatedResponseSchema (generic offset envelope)', () => {
  const ItemSchema = z.object({ id: z.string() });
  const Paged = makePaginatedResponseSchema(ItemSchema);
  const good = { data: [{ id: 'a' }], page: 1, pageSize: 20, total: 1, totalPages: 1, hasMore: false };
  it('accepts a well-formed page envelope with a typed data array', () => {
    expect(Paged.parse(good)).toEqual(good);
  });
  it('rejects a negative total (kills nonnegative() removal)', () => {
    expect(Paged.safeParse({ ...good, total: -1 }).success).toBe(false);
  });
  it('rejects a data item that violates the item schema', () => {
    expect(Paged.safeParse({ ...good, data: [{ id: 1 }] }).success).toBe(false);
  });
  it('requires the hasMore flag (kills field removal)', () => {
    const { hasMore, ...withoutFlag } = good;
    void hasMore;
    expect(Paged.safeParse(withoutFlag).success).toBe(false);
  });
});
