// apps/api/test/transport-orders-export.vn-date.integration.test.ts
// outside-in strict TDD RED (t65 Vietnamese-date-format arc): the Ngày dự kiến
// column of the Lệnh điều xe workbook is a REAL DATE CELL carrying the
// Asia/Ho_Chi_Minh calendar day, displayed as dd/mm/yyyy.
//
// WHY A DATE CELL AND NOT A VIETNAMESE STRING. The service currently formats
// the instant with an en-GB Intl formatter and writes the resulting TEXT. Two
// things are wrong with that. The visible one is the locale: a Vietnamese-only
// product must not emit an English date. The deeper one is the CELL TYPE: a
// text cell cannot be sorted chronologically, filtered by a date range, or fed
// into a date formula, which is the entire reason an owner asks for an export
// rather than a screenshot. Writing a Date value plus a display format gives
// the correct appearance AND preserves the underlying value, which is the 2026
// spreadsheet-export convention.
//
// WHY THE VALUE MUST BE THE VIETNAM CALENDAR DAY, NOT THE RAW INSTANT. ExcelJS
// serializes a Date to the workbook serial number using the value's UTC parts.
// So if the service handed it the raw UTC instant, an evening Vietnam departure
// stored as 2026-05-30T17:30Z would land in the sheet as 30/05 while the
// dispatch board (which pins Asia/Ho_Chi_Minh) shows 31/05. The owner would be
// reconciling two documents that disagree by a day. The service must therefore
// resolve the VN wall-clock date first and write THAT calendar day, which is
// what the boundary case below proves.
//
// WHY numFmt IS LOWER-CASE HERE. Excel number-format tokens are a different
// grammar from Intl option values: they are locale-independent and lower-case,
// so the display mask is dd/mm/yyyy even though the UI contract describes the
// same shape as dd/MM/yyyy. Both come from the @fleet/sync-protocol SSOT.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { TransportOrdersExportService } from '../src/transport-orders/transport-orders-export.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';
import { LENH_DIEU_XE_EXPORT_HEADERS, VN_EXCEL_DATE_NUMFMT } from '@fleet/sync-protocol';
let testDb: PgliteTestDb;
let svc: TransportOrdersExportService;
const OP = createOperatorContext({ companyId: '00000000-0000-0000-0000-000000000aaa' });
function q(s: string): string { return String.fromCharCode(39) + s + String.fromCharCode(39); }
// Column index of Ngày dự kiến, derived from the header SSOT rather than the
// literal 7, so a future column insertion cannot silently point this spec at the
// wrong cell while still passing.
const PLANNED_COL = LENH_DIEU_XE_EXPORT_HEADERS.indexOf('Ngày dự kiến') + 1;
async function seedProjection(roadRunId: string, refs: readonly string[], plannedStartAt: string): Promise<void> {
  const co = OP.companyId;
  const refsJson = JSON.stringify(refs);
  const stmt =
    'INSERT INTO dispatch_board_projection ' +
    '(road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, ' +
    ' state, stop_count, transport_order_refs, server_seq, planned_start_at) ' +
    'VALUES (' + q(roadRunId) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ', ' +
    q('planned') + ',2,' + q(refsJson) + '::jsonb,1,' + q(plannedStartAt) + ')';
  await testDb.db.execute(sql.raw(stmt));
}
async function plannedCell(): Promise<ExcelJS.Cell> {
  const res = await svc.exportAndLog(OP, 'manual');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('no worksheet');
  return ws.getRow(2).getCell(PLANNED_COL);
}
beforeAll(async () => {
  testDb = await startPgliteTestDb();
  svc = new TransportOrdersExportService(testDb.db);
});
afterAll(async () => { await stopPgliteTestDb(testDb); });
beforeEach(async () => {
  await testDb.db.execute(sql.raw('DELETE FROM dispatch_board_projection'));
  await testDb.db.execute(sql.raw('DELETE FROM transport_order_export_log'));
});
describe('@fleet/api - Ngày dự kiến is a Vietnamese-formatted date cell', () => {
  it('writes a real Date value, not pre-formatted text', async () => {
    await seedProjection('00000000-0000-4000-8000-00000000d001', ['XTT.05-001'], '2026-05-24T08:00:00Z');
    const cell = await plannedCell();
    expect(cell.value instanceof Date).toBe(true);
  });
  it('carries the dd/mm/yyyy display format from the shared contract', async () => {
    await seedProjection('00000000-0000-4000-8000-00000000d001', ['XTT.05-001'], '2026-05-24T08:00:00Z');
    const cell = await plannedCell();
    expect(cell.numFmt).toBe(VN_EXCEL_DATE_NUMFMT);
  });
  // NOTE ON HOW THIS IS ASSERTED. The obvious phrasing -- stringify the cell
  // value and look for May -- is unsatisfiable for ANY date cell and would be
  // a permanently red test rather than a real guarantee: Date.prototype
  // .toString renders in the HOST timezone and locale, so on this machine a
  // correct UTC-midnight value prints as Sat May 23 2026 ... GMT-0700. That
  // string is Node debug output; it is never what Excel shows. What actually
  // guarantees no English month reaches the owner is the pair below: no
  // pre-formatted TEXT was written into the cell, and the display mask
  // carries no month-name token (mmm/mmmm), only numeric ones.
  it('writes no text into the cell and uses a mask with no month-name token', async () => {
    await seedProjection('00000000-0000-4000-8000-00000000d001', ['XTT.05-001'], '2026-05-24T08:00:00Z');
    const cell = await plannedCell();
    expect(typeof cell.value).not.toBe('string');
    expect(cell.numFmt).not.toContain('mmm');
  });
  it('stores the Asia/Ho_Chi_Minh calendar day for a daytime instant', async () => {
    // 08:00Z on 24/05 is 15:00 the same day in Vietnam.
    await seedProjection('00000000-0000-4000-8000-00000000d001', ['XTT.05-001'], '2026-05-24T08:00:00Z');
    const cell = await plannedCell();
    const d = cell.value as Date;
    expect([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]).toEqual([2026, 5, 24]);
  });
  it('stores the NEXT Vietnamese calendar day for a late-evening UTC instant', async () => {
    // 17:30Z on 30/05 is already 00:30 on 31/05 in Vietnam. A cell built from
    // the raw UTC instant would read 30/05 and contradict the dispatch board.
    await seedProjection('00000000-0000-4000-8000-00000000d002', ['XTT.05-002'], '2026-05-30T17:30:00Z');
    const cell = await plannedCell();
    const d = cell.value as Date;
    expect([d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()]).toEqual([2026, 5, 31]);
  });
  it('keeps the whole column formatted, so a second row cannot drift', async () => {
    await seedProjection('00000000-0000-4000-8000-00000000d001', ['XTT.05-001'], '2026-05-24T08:00:00Z');
    await seedProjection('00000000-0000-4000-8000-00000000d002', ['XTT.05-002'], '2026-05-30T17:30:00Z');
    const res = await svc.exportAndLog(OP, 'manual');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.buffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('no worksheet');
    expect(ws.getRow(3).getCell(PLANNED_COL).numFmt).toBe(VN_EXCEL_DATE_NUMFMT);
  });
});
