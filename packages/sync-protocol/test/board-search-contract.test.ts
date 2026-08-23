// packages/sync-protocol/test/board-search-contract.test.ts
// Contract for the board-search coverage registry (three-state taxonomy).
//
// Root cause this closes: WHICH columns the dispatcher search covers lived only
// as prose in a dispatch.controller.ts comment plus hand-written or() arms, with
// hand-picked tests. Nothing tied the three together, so the e2e could claim ANY
// column while proving two, and a join edit could silently kill a column search.
// Same failure shape transport-order-export-headers.ts already fixed for these
// exact labels: copies drifted until one importable definition made it
// structurally impossible.
//
// Contract: every NAME column of the export SSOT (LENH_DIEU_XE_EXPORT_HEADERS
// minus the kg pairs) maps to exactly one registry entry, classified as exactly
// one of searchable (names a predicate) / derived (no stored column) / facet
// (finite enum filtered elsewhere). No column may be left unclassified: adding an
// export column without a decision fails this suite.
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
  it('every entry is exactly one of the three kinds', () => {
    for (const c of BOARD_SEARCH_COLUMNS) {
      expect(['searchable', 'derived', 'facet']).toContain(c.kind);
    }
  });
  it('a searchable column carries a predicate', () => {
    for (const c of boardSearchableColumns()) {
      expect(typeof c.predicate).toBe('string');
      expect(c.predicate.length).toBeGreaterThan(0);
    }
  });
  it('rejects a searchable column with no predicate', () => {
    expect(() =>
      BoardSearchColumnSchema.parse({
        id: 'bogus',
        labels: ['X'],
        kind: 'searchable',
      }),
    ).toThrow();
  });
  it('rejects a derived column with no reason', () => {
    expect(() =>
      BoardSearchColumnSchema.parse({
        id: 'bogus',
        labels: ['X'],
        kind: 'derived',
      }),
    ).toThrow();
  });
  it('rejects a facet column with no filteredBy', () => {
    expect(() =>
      BoardSearchColumnSchema.parse({
        id: 'bogus',
        labels: ['X'],
        kind: 'facet',
        reason: 'r',
      }),
    ).toThrow();
  });
});
describe('board-search contract: derived from the export header SSOT', () => {
  it('name headers are the export SSOT minus the kg pair columns', () => {
    const expected = LENH_DIEU_XE_EXPORT_HEADERS.filter((h) => !h.endsWith(EXPORT_KG_SUFFIX));
    expect(boardSearchNameHeaders()).toEqual(expected);
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
describe('board-search contract: exclusions are typed, not silent', () => {
  it('the weight diff is classified derived with a stated reason', () => {
    const diff = BOARD_SEARCH_COLUMNS.find((c) => c.id === 'weightDiffKg');
    if (diff === undefined) throw new Error('weightDiffKg is not registered');
    if (diff.kind !== 'derived') throw new Error('weightDiffKg must be derived');
    expect(diff.reason.length).toBeGreaterThan(0);
  });
  it('status is classified facet with a filter mechanism and reason', () => {
    const status = BOARD_SEARCH_COLUMNS.find((c) => c.id === 'status');
    if (status === undefined) throw new Error('status is not registered');
    if (status.kind !== 'facet') throw new Error('status must be a facet');
    expect(status.filteredBy.length).toBeGreaterThan(0);
    expect(status.reason.length).toBeGreaterThan(0);
  });
  it('neither derived nor facet columns appear in the searchable set', () => {
    const searchableIds = new Set(boardSearchableColumns().map((c) => c.id));
    expect(searchableIds.has('weightDiffKg')).toBe(false);
    expect(searchableIds.has('status')).toBe(false);
  });
  it('every name header not excluded is searchable', () => {
    const excluded = new Set(
      BOARD_SEARCH_COLUMNS.filter((c) => c.kind !== 'searchable').flatMap((c) => [...c.labels]),
    );
    const searchableLabels = new Set(boardSearchableColumns().flatMap((c) => [...c.labels]));
    for (const header of boardSearchNameHeaders()) {
      if (excluded.has(header)) continue;
      expect(searchableLabels.has(header)).toBe(true);
    }
  });
});
