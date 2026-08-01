// packages/sync-protocol/test/transport-order-export-query-contract.test.ts
// RED (T67): the Lenh dieu xe Excel export must honour the dispatcher ACTIVE
// board search term and status tab.
//
// Root cause this closes: GET /transport-orders-export.xlsx parses ONLY from/to
// (transport-orders-export.controller.ts), and exportOrdersExcel builds ONLY
// ?from=&to= (export-orders-excel.action.ts). The board search (?search=) and
// the status group (?group=) are never forwarded, so pressing Xuat Excel while a
// search is active silently exports the WHOLE board instead of the rows the
// dispatcher can actually see. 2026 export practice (Google Voice, Salesforce,
// 340B OPAIS): an export returns the records matching the CURRENT search, never
// a superset.
//
// Contract: ONE query schema shared by the ops-web server action and the API
// controller, extending the existing day-range SSOT with the SAME search and
// group vocabulary the board already validates. An empty query keeps the
// unfiltered semantics so the login/logout daily-backup ledger exports stay
// full-board.
import { describe, it, expect } from 'vitest';
import { ExportQuerySchema } from '../src/transport-order-export-contract.js';
import { ROAD_RUN_STATUS_GROUPS } from '../src/dispatch-board-pagination-contract.js';
import { boardSearchableColumns } from '../src/board-search-contract.js';
describe('export query contract: search and group are carried', () => {
  it('accepts a bare search term with no date range', () => {
    const parsed = ExportQuerySchema.parse({ search: 'TAN KY NGUYEN' });
    expect(parsed.search).toBe('TAN KY NGUYEN');
    expect(parsed.from).toBeUndefined();
    expect(parsed.to).toBeUndefined();
  });
  it('accepts every board status group', () => {
    for (const g of ROAD_RUN_STATUS_GROUPS) {
      expect(ExportQuerySchema.parse({ group: g }).group).toBe(g);
    }
  });
  it('accepts search, group and an inclusive day range together', () => {
    const parsed = ExportQuerySchema.parse({
      from: '2026-07-01', to: '2026-07-31', search: 'TRAU', group: 'active',
    });
    expect(parsed.from).toBe('2026-07-01');
    expect(parsed.to).toBe('2026-07-31');
    expect(parsed.search).toBe('TRAU');
    expect(parsed.group).toBe('active');
  });
  it('an empty query stays unfiltered (daily-backup invariant)', () => {
    const parsed = ExportQuerySchema.parse({});
    expect(parsed.search).toBeUndefined();
    expect(parsed.group).toBeUndefined();
    expect(parsed.from).toBeUndefined();
    expect(parsed.to).toBeUndefined();
  });
});
describe('export query contract: invalid input fails at the boundary', () => {
  it('rejects a half-specified day range', () => {
    expect(ExportQuerySchema.safeParse({ from: '2026-07-01' }).success).toBe(false);
    expect(ExportQuerySchema.safeParse({ to: '2026-07-31' }).success).toBe(false);
  });
  it('rejects an inverted day range', () => {
    expect(ExportQuerySchema.safeParse({ from: '2026-07-31', to: '2026-07-01' }).success).toBe(false);
  });
  it('rejects a malformed day key', () => {
    expect(ExportQuerySchema.safeParse({ from: '01-07-2026', to: '31-07-2026' }).success).toBe(false);
  });
  it('rejects an empty search term', () => {
    expect(ExportQuerySchema.safeParse({ search: '' }).success).toBe(false);
  });
  it('rejects an unknown status group', () => {
    expect(ExportQuerySchema.safeParse({ group: 'archived' }).success).toBe(false);
  });
  it('rejects stray keys so a typo is a 400, not a silent full export', () => {
    expect(ExportQuerySchema.safeParse({ page: 2 }).success).toBe(false);
  });
});
describe('export query contract: bound to the board search registry', () => {
  it('the export term reaches every searchable board column', () => {
    const predicates = boardSearchableColumns().map((c) => c.predicate);
    expect(predicates.length).toBeGreaterThan(0);
    const required = ['orderRefs', 'customer', 'cargoName', 'driverName', 'vehiclePlate', 'plannedStartAt', 'stopCount', 'warehouseName'];
    for (const p of required) {
      expect(predicates).toContain(p);
    }
  });
});
