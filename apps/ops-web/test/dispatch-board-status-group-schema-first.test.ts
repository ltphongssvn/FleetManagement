// apps/ops-web/test/dispatch-board-status-group-schema-first.test.ts
// RED-first (schema-first arc, board status group): the dispatcher board's
// status-group vocabulary and its ?group=/?page=/?search= URL parsing must both
// derive from the ONE @fleet/sync-protocol SSOT.
//
// Axis-2 violation being closed: DispatchView.tsx hand-writes
//   export type BoardStatusGroup = 'active' | 'finished' | 'cancelled'
// a structural twin of roadRunStatusGroupSchema's z.infer. It only compiles
// because the two happen to coincide today; adding a 4th group to the SSOT would
// NOT fail this file. load-board-page.ts already imports RoadRunStatusGroup from
// the contract, so the twin is the lone hold-out.
//
// Axis-1 violation being closed: page.tsx hand-rolls parseGroup/parsePage/
// parseSearch over searchParams -- untrusted URL input -- while
// RoadRunPageQuerySchema already defines exactly that boundary contract
// (group defaults to active, page coerced positive int, search min(1)).
//
// Contract after conversion:
//   - parseBoardSearchParams() is the ops-web boundary parser, returning the
//     SSOT-inferred RoadRunPageQuery. Garbage never throws: each field falls back
//     to the schema default so a hand-edited URL renders the default board.
//   - SOURCE GUARD: no twin union in DispatchView, no parseGroup in page.tsx,
//     both reference the contract, and the stale 'finished = completed +
//     cancelled' comments (contradicted by the T16 Lenh Huy carve-out) are gone.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROAD_RUN_STATUS_GROUPS, ROAD_RUN_PAGE_SIZE_DEFAULT } from '@fleet/sync-protocol';
import { parseBoardSearchParams } from '@/features/dispatch/parse-board-params';
const here = dirname(fileURLToPath(import.meta.url));
const src = (rel: string): string => readFileSync(resolve(here, '../src', rel), 'utf8');
// Collapse line-comment markers + whitespace so a guard string still matches
// when a sentence is wrapped across two comment lines.
const flat = (s: string): string => s.replace(/\s+\/\/\s*/g, ' ').replace(/\s+/g, ' ');
describe('board status group + board URL params are schema-first', () => {
  it('accepts every group in the SSOT enum (no local list)', () => {
    for (const g of ROAD_RUN_STATUS_GROUPS) {
      expect(parseBoardSearchParams({ group: g }).group).toBe(g);
    }
  });
  it('falls back to the schema default for a garbage ?group=', () => {
    expect(parseBoardSearchParams({ group: 'bogus' }).group).toBe('active');
    expect(parseBoardSearchParams({}).group).toBe('active');
  });
  it('takes the first value of a repeated ?group=', () => {
    expect(parseBoardSearchParams({ group: ['cancelled', 'active'] }).group).toBe('cancelled');
  });
  it('a garbage ?group= does not discard a valid ?page=', () => {
    expect(parseBoardSearchParams({ group: 'bogus', page: '3' }).page).toBe(3);
  });
  it('coerces ?page= and defaults invalid/absent to 1', () => {
    expect(parseBoardSearchParams({ page: '3' }).page).toBe(3);
    expect(parseBoardSearchParams({ page: '0' }).page).toBe(1);
    expect(parseBoardSearchParams({ page: 'abc' }).page).toBe(1);
    expect(parseBoardSearchParams({}).page).toBe(1);
  });
  it('normalizes ?search= to undefined when blank, trims otherwise', () => {
    expect(parseBoardSearchParams({ search: '   ' }).search).toBeUndefined();
    expect(parseBoardSearchParams({}).search).toBeUndefined();
    expect(parseBoardSearchParams({ search: ' XTT.07 ' }).search).toBe('XTT.07');
  });
  it('defaults pageSize from the SSOT constant', () => {
    expect(parseBoardSearchParams({}).pageSize).toBe(ROAD_RUN_PAGE_SIZE_DEFAULT);
  });
  it('source guard: no hand-written twin union, contract imported', () => {
    const view = src('features/dispatch/DispatchView.tsx');
    const page = src('app/page.tsx');
    expect(view.includes('export type BoardStatusGroup')).toBe(false);
    expect(view.includes('@fleet/sync-protocol')).toBe(true);
    expect(page.includes('function parseGroup')).toBe(false);
    expect(page.includes('BoardStatusGroup')).toBe(false);
    expect(page.includes('parse-board-params')).toBe(true);
  });
  it('source guard: stale finished-includes-cancelled comments are gone', () => {
    expect(flat(src('features/dispatch/DispatchView.tsx')).includes('Finished = completed + cancelled')).toBe(false);
    expect(flat(src('app/page.tsx')).includes('Active/Finished tabs')).toBe(false);
  });
});
