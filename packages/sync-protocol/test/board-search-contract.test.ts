// packages/sync-protocol/test/board-search-contract.test.ts
// Outside-in RED (board-search coverage arc, 2026-07-15): the SSOT registry of
// WHICH board columns are searchable, and why an excluded one is excluded.
//
// Root cause this closes: the searchable-column set existed only as prose in a
// dispatch.controller.ts comment plus hand-written or() arms, with hand-picked
// tests. Nothing tied the three together, so the e2e could claim ANY column
// while proving two, and a join edit could silently kill Xe or Kho giao hang.
// Same failure shape transport-order-export-headers.ts already fixed for these
// exact labels: copies drifted until one importable definition made it
// structurally impossible.
//
// Contract: every NAME column of the export SSOT (LENH_DIEU_XE_EXPORT_HEADERS
// minus the kg pairs == the 12 dispatcher labels) maps to exactly one registry
// entry. A column is searchable (carries a predicate id) or explicitly not
// (carries a reason). No third state. Adding an export column without deciding
// its search story fails this suite.
import { describe, it, expect } from 'vitest';
import {
  BoardSearchColumnSchema,
  BOARD_SEARCH_COLUMNS,
  boardSearchableColumns,
  boardSearchNameHeaders,
} from '../src/board-search-contract.js';
import {
  LENH_DIEU_XE_EXPORT_HEADERS,
  EXPORT_KG_SUFFIX,
} from '../src/transport-order-export-headers.js';

describe('board-search contract: registry shape', () => {
  it('every entry parses under the Zod contract', () => {
    for (const c of BOARD_SEARCH_COLUMNS) {
      expect(() => BoardSearchColumnSchema.parse(c)).not.toThrow();
    }
  });
  it('column ids are unique', () => {
    const ids = BOARD_SEARCH_COLUMNS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('a searchable column carries a predicate id and no reason', () => {
    for (const c of boardSearchableColumns()) {
      expect(c.searchable).toBe(true);
      expect(typeof c.predicate).toBe('string');
      expect(c.predicate.length).toBeGreaterThan(0);
    }
  });
  it('rejects an unsearchable column with no reason', () => {
    expect(() => BoardSearchColumnSchema.parse({
      id: 'bogus', labels: ['X'], searchable: false,
    })).toThrow();
  });
  it('rejects a searchable column with no predicate', () => {
    expect(() => BoardSearchColumnSchema.parse({
      id: 'bogus', labels: ['X'], searchable: true,
    })).toThrow();
  });
});

describe('board-search contract: derived from the export header SSOT', () => {
  it('name headers are the export SSOT minus the kg pair columns', () => {
    const expected = LENH_DIEU_XE_EXPORT_HEADERS.filter((h) => !h.endsWith(EXPORT_KG_SUFFIX));
    expect(boardSearchNameHeaders()).toEqual(expected);
  });
  it('the dispatcher sees exactly twelve name columns', () => {
    expect(boardSearchNameHeaders()).toHaveLength(12);
  });
  it('every registry label comes from the export SSOT (no invented labels)', () => {
    const known = new Set(boardSearchNameHeaders());
    for (const c of BOARD_SEARCH_COLUMNS) {
      for (const label of c.labels) expect(known.has(label)).toBe(true);
    }
  });
  it('every name header is claimed by exactly one entry (exhaustive, disjoint)', () => {
    const claims = new Map<string, number>();
    for (const c of BOARD_SEARCH_COLUMNS) {
      for (const label of c.labels) claims.set(label, (claims.get(label) ?? 0) + 1);
    }
    for (const header of boardSearchNameHeaders()) {
      expect(claims.get(header)).toBe(1);
    }
  });
});

describe('board-search contract: the Chenh lech exclusion is explicit, not silent', () => {
  it('registers the weight diff as unsearchable with a stated reason', () => {
    const diff = BOARD_SEARCH_COLUMNS.find((c) => c.id === 'weightDiffKg');
    expect(diff).toBeDefined();
    // Narrow in two steps. Fusing them (diff?.searchable !== false) is what
    // prefer-optional-chain asks for, but the optional chain does NOT narrow the
    // union, so tsc then rejects diff.reason as unreachable on the searchable arm.
    // Guard undefined first, THEN discriminate: both rules hold and the compiler
    // proves reason exists rather than the test probing for it.
    if (diff === undefined) throw new Error('weightDiffKg is not registered');
    if (diff.searchable) throw new Error('weightDiffKg must be unsearchable');
    expect(diff.reason.length).toBeGreaterThan(0);
  });
  it('excludes it from the searchable set', () => {
    expect(boardSearchableColumns().some((c) => c.id === 'weightDiffKg')).toBe(false);
  });
  it('every OTHER name column is searchable', () => {
    const diff = BOARD_SEARCH_COLUMNS.find((c) => c.id === 'weightDiffKg');
    const excluded = new Set(diff === undefined ? [] : diff.labels);
    const searchableLabels = new Set(boardSearchableColumns().flatMap((c) => [...c.labels]));
    for (const header of boardSearchNameHeaders()) {
      if (excluded.has(header)) continue;
      expect(searchableLabels.has(header)).toBe(true);
    }
  });
});
