// apps/api/test/board-search-clause.contract.test.ts
// RED (T67): the board free-text search clause must live in ONE place that both
// the dispatch board AND the Excel export import.
//
// Root cause this closes: buildSearchClause was a PRIVATE method on
// DispatchController. The export service physically could not reach it, so the
// export shipped with no search support at all -- pressing Xuat Excel while a
// search was active exported the whole board. A private method is not a
// contract; extracting it to a shared module is the source-level fix, not a
// symptom patch.
//
// The second assertion is the drift guard: the SQL builder advertises the
// predicate ids it covers, and that set must equal the searchable arm of the
// board-search registry in @fleet/sync-protocol. Add a searchable column to the
// contract without writing its SQL and this suite fails, instead of the column
// silently never matching in production.
import { describe, it, expect } from 'vitest';
import { boardSearchableColumns } from '@fleet/sync-protocol';
import {
  buildBoardSearchClause,
  BOARD_SEARCH_CLAUSE_PREDICATES,
} from '../src/dispatch/board-search-clause.js';
describe('board search clause: shared builder', () => {
  it('returns undefined when no term is given, so callers keep the base predicate', () => {
    expect(buildBoardSearchClause('co-1', undefined)).toBeUndefined();
    expect(buildBoardSearchClause('co-1', '')).toBeUndefined();
  });
  it('returns a clause when a term is given', () => {
    expect(buildBoardSearchClause('co-1', 'TRAU')).toBeDefined();
  });
});
describe('board search clause: bound to the SSOT registry', () => {
  it('covers exactly the searchable arm of the board-search contract', () => {
    const expected = [...new Set(boardSearchableColumns().map((c) => c.predicate))].sort();
    const actual = [...BOARD_SEARCH_CLAUSE_PREDICATES].sort();
    expect(actual).toEqual(expected);
  });
  it('advertises no predicate the contract does not declare', () => {
    const declared = new Set(boardSearchableColumns().map((c) => c.predicate));
    for (const p of BOARD_SEARCH_CLAUSE_PREDICATES) {
      expect(declared.has(p)).toBe(true);
    }
  });
});
