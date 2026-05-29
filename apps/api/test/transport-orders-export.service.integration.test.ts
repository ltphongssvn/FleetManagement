// apps/api/test/transport-orders-export.service.integration.test.ts
//
// L4 RED for export-backup feature. TransportOrdersExportService is
// responsible for:
//   1) reading dispatch_board_projection rows scoped to the operator's
//      companyId (same scope rule as DispatchController.getBoard);
//   2) producing an .xlsx Buffer whose first sheet has the Vietnamese
//      headers Số lệnh / Trạng thái / Tài xế / Xe / Ngày dự kiến / Số điểm
//      with row data mirroring the projection rows;
//   3) writing a row to transport_order_export_log with row_count, sha256
//      of the buffer, and the canonical filename;
//   4) honoring idempotency for trigger='login'|'logout' on the same
//      VN-tz day (no duplicate ledger rows, return the existing one).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { TransportOrdersExportService } from '../src/transport-orders/transport-orders-export.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
let svc: TransportOrdersExportService;
const OP = createOperatorContext({ companyId: '00000000-0000-0000-0000-000000000aaa' });
async function seedProjection(roadRunId: string, refs: readonly string[]): Promise<void> {
  const co = OP.companyId;
  const refsJson = JSON.stringify(refs);
  const q =
    'INSERT INTO dispatch_board_projection ' +
    '(road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, ' +
    ' state, stop_count, transport_order_refs, server_seq, planned_start_at) ' +
    "VALUES ('" + roadRunId + "','" + co + "','" + co + "','" + co + "','" + co + "', " +
    "'planned',2,'" + refsJson + "'::jsonb,1,'2026-05-24T08:00:00Z')";
  await testDb.db.execute(sql.raw(q));
}
describe('@fleet/api - TransportOrdersExportService (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    svc = new TransportOrdersExportService(testDb.db as never);
  }, 60_000);
  afterAll(async () => stopPgliteTestDb(testDb));
  beforeEach(async () => {
    await testDb.db.execute(sql.raw('TRUNCATE TABLE dispatch_board_projection CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE transport_order_export_log CASCADE'));
  });
  it('manual: produces xlsx with Vietnamese headers and inserts a ledger row', async () => {
    await seedProjection('aaaaaaaa-1111-4111-8111-111111111111', ['XT.1001']);
    const r = await svc.exportAndLog(OP, 'manual');
    expect(r.buffer).toBeInstanceOf(Buffer);
    expect(r.rowCount).toBe(1);
    expect(r.filename).toMatch(/^lenh-dieu-xe_.+_\d{4}-\d{2}-\d{2}_manual_[a-f0-9]+\.xlsx$/);
    expect(r.sha256).toBe(createHash('sha256').update(r.buffer).digest('hex'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('no worksheet');
    const header = (ws.getRow(1).values as unknown[]).slice(1) as string[];
    expect(header).toEqual(['Số lệnh', 'Trạng thái', 'Tài xế', 'Xe', 'Ngày dự kiến', 'Số điểm']);
    const dataRow = (ws.getRow(2).values as unknown[]).slice(1);
    expect(dataRow[0]).toBe('XT.1001');
    const logRows = await testDb.db.execute(sql.raw(
      'SELECT trigger, row_count, sha256 FROM transport_order_export_log'
    ));
    expect(logRows.rows).toHaveLength(1);
    expect((logRows.rows[0] as { trigger: string }).trigger).toBe('manual');
  });
  it('login: idempotent — second call same day returns the same ledger id', async () => {
    await seedProjection('bbbbbbbb-1111-4111-8111-111111111111', ['XT.1002']);
    const a = await svc.exportAndLog(OP, 'login');
    const b = await svc.exportAndLog(OP, 'login');
    expect(b.exportLogId).toBe(a.exportLogId);
    const cnt = await testDb.db.execute<{ c: number }>(sql.raw(
      "SELECT COUNT(*)::int AS c FROM transport_order_export_log WHERE trigger = 'login'"
    ));
    expect((cnt.rows[0] as { c: number }).c).toBe(1);
  });
  it('logout: idempotent same day', async () => {
    await seedProjection('cccccccc-1111-4111-8111-111111111111', ['XT.1003']);
    await svc.exportAndLog(OP, 'logout');
    await svc.exportAndLog(OP, 'logout');
    const cnt = await testDb.db.execute<{ c: number }>(sql.raw(
      "SELECT COUNT(*)::int AS c FROM transport_order_export_log WHERE trigger = 'logout'"
    ));
    expect((cnt.rows[0] as { c: number }).c).toBe(1);
  });
  it('manual: NOT idempotent — two manual exports same day create two rows', async () => {
    await seedProjection('dddddddd-1111-4111-8111-111111111111', ['XT.1004']);
    await svc.exportAndLog(OP, 'manual');
    await svc.exportAndLog(OP, 'manual');
    const cnt = await testDb.db.execute<{ c: number }>(sql.raw(
      "SELECT COUNT(*)::int AS c FROM transport_order_export_log WHERE trigger = 'manual'"
    ));
    expect((cnt.rows[0] as { c: number }).c).toBe(2);
  });
  it('tenant scope: rows from another company are not exported', async () => {
    const otherCo = '00000000-0000-0000-0000-000000000bbb';
    const refsJson = JSON.stringify(['XT.OTHER']);
    const q =
      'INSERT INTO dispatch_board_projection ' +
      '(road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, ' +
      ' state, stop_count, transport_order_refs, server_seq, planned_start_at) ' +
      "VALUES ('eeeeeeee-1111-4111-8111-111111111111','" + otherCo + "','" + otherCo + "','" + otherCo + "','" + otherCo + "', " +
      "'planned',2,'" + refsJson + "'::jsonb,1,'2026-05-24T08:00:00Z')";
    await testDb.db.execute(sql.raw(q));
    await seedProjection('ffffffff-1111-4111-8111-111111111111', ['XT.MINE']);
    const r = await svc.exportAndLog(OP, 'manual');
    expect(r.rowCount).toBe(1);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; if (!ws) throw new Error('no worksheet');
    const refs: string[] = [];
    ws.eachRow((row, idx) => { if (idx > 1) { const v = row.getCell(1).value; if (typeof v === 'string') refs.push(v); } });
    expect(refs).toEqual(['XT.MINE']);
  });
});
