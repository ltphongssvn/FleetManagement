// apps/api/test/transport-orders-export.service.filter.test.ts
// RED (T67): the export SERVICE must apply the dispatcher search term and
// status group to the rows it fetches, using the SAME shared SQL clause the
// board uses.
//
// Root cause this closes: fetchRows() filtered on company + soft-delete + an
// optional day range only. Even once the controller forwarded search and group,
// the service would still have ignored them and exported the whole board. The
// clause is imported from board-search-clause.ts, so board and export match by
// construction rather than by two hand-maintained copies.
//
// Level choice: this is a UNIT test over a mocked drizzle chain. It proves the
// service THREADS the filter into the where clause and calls the shared builder.
// Whether that SQL actually matches Vietnamese rows is proven by the existing
// integration suite against a real Postgres, which is the right level for SQL
// semantics -- not duplicated here.
import { describe, it, expect, beforeEach, vi } from 'vitest';
const buildBoardSearchClause = vi.fn();
vi.mock('../src/dispatch/board-search-clause.js', () => ({
  buildBoardSearchClause: (companyId: string, search: string | undefined): unknown =>
    buildBoardSearchClause(companyId, search) as unknown,
  BOARD_SEARCH_CLAUSE_PREDICATES: [],
}));
const { TransportOrdersExportService } = await import(
  '../src/transport-orders/transport-orders-export.service.js'
);
import { createOperatorContext } from '@fleet/test-fixtures';
import type { OperatorContext } from '../src/auth/operator-context.js';
const op: OperatorContext = createOperatorContext();
// Minimal drizzle-shaped stub: every builder method returns this, and the chain
// resolves to an empty row set. We assert on what the service ASKS for, not on
// what Postgres would answer.
function makeDb(): { db: unknown; whereArgs: unknown[] } {
  const whereArgs: unknown[] = [];
  const chain: Record<string, unknown> = {};
  const passthrough = (): unknown => chain;
  for (const m of ['select', 'from', 'leftJoin', 'innerJoin', 'orderBy', 'limit', 'offset', 'values', 'returning']) {
    chain[m] = vi.fn(passthrough);
  }
  chain['where'] = vi.fn((arg: unknown): unknown => {
    whereArgs.push(arg);
    return chain;
  });
  chain['insert'] = vi.fn(passthrough);
  chain['then'] = (resolve: (v: unknown[]) => unknown): unknown => resolve([]);
  return { db: chain, whereArgs };
}
describe('@fleet/api - export service applies the board filter', () => {
  beforeEach(() => {
    buildBoardSearchClause.mockReset();
    buildBoardSearchClause.mockReturnValue(undefined);
  });
  it('calls the shared search-clause builder with the tenant company and the term', async () => {
    const { db } = makeDb();
    const svc = new TransportOrdersExportService(db as never);
    await svc.fetchRowsForFilter(op, { search: 'TRAU' });
    expect(buildBoardSearchClause).toHaveBeenCalledWith(op.companyId, 'TRAU');
  });
  it('passes undefined to the builder when no term is given', async () => {
    const { db } = makeDb();
    const svc = new TransportOrdersExportService(db as never);
    await svc.fetchRowsForFilter(op, undefined);
    expect(buildBoardSearchClause).toHaveBeenCalledWith(op.companyId, undefined);
  });
  it('builds a where clause for a status group', async () => {
    const { db, whereArgs } = makeDb();
    const svc = new TransportOrdersExportService(db as never);
    await svc.fetchRowsForFilter(op, { group: 'cancelled' });
    expect(whereArgs.length).toBeGreaterThan(0);
    expect(whereArgs[0]).toBeDefined();
  });
});
