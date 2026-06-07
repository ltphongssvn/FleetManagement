// apps/api/test/transport-orders-export.service.integration.test.ts
//
// L4 contract for the export-backup feature. TransportOrdersExportService:
//   1) reads dispatch_board_projection scoped to companyId (DispatchController
//      scope rule), enriched at read time with the SAME joins the board uses:
//      customer name + phone (road_run_transport_order -> transport_order ->
//      customer) and per-stop status (road_run_transport_order -> stop ->
//      warehouse);
//   2) produces an .xlsx whose first sheet header is EXACTLY the on-screen
//      Lệnh điều xe columns, in order:
//        Số lệnh | Khách hàng | Tài xế | Xe | Ngày dự kiến | Số điểm |
//        Điểm nhận hàng 1..4 | Kho giao hàng 1
//      The Khách hàng cell carries the customer name and, when present, the
//      phone on a second line (the on-screen cell stacks name over phone);
//      Excel is flat so the phone is folded into that one cell, NOT a column.
//      Each Điểm/Kho cell carries the per-stop status string the board renders
//      (stopStatusOf): 'Chưa tới' until arrived/departed, else
//      'Đã hoàn thành <vn-date>'; em-dash when the slot has no stop.
//   3) writes a transport_order_export_log row (row_count, sha256, filename);
//   4) honors idempotency for trigger='login'|'logout' per VN-tz day.
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
const EXPECTED_HEADERS = [
  'Số lệnh', 'Khách hàng', 'Tài xế', 'Xe', 'Ngày dự kiến', 'Số điểm',
  'Điểm nhận hàng 1', 'Điểm nhận hàng 2', 'Điểm nhận hàng 3', 'Điểm nhận hàng 4', 'Kho giao hàng 1',
];
function q(s: string): string { return String.fromCharCode(39) + s + String.fromCharCode(39); }
async function seedProjection(roadRunId: string, refs: readonly string[]): Promise<void> {
  const co = OP.companyId;
  const refsJson = JSON.stringify(refs);
  const stmt =
    'INSERT INTO dispatch_board_projection ' +
    '(road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, ' +
    ' state, stop_count, transport_order_refs, server_seq, planned_start_at) ' +
    'VALUES (' + q(roadRunId) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ', ' +
    q('planned') + ',2,' + q(refsJson) + '::jsonb,1,' + q('2026-05-24T08:00:00Z') + ')';
  await testDb.db.execute(sql.raw(stmt));
}
// Seed the full read graph the board/export enrichment joins traverse:
// road_run_transport_order -> transport_order(customerId) -> customer(name,phone)
// and road_run_transport_order -> stop(yardId,arrived/departed) -> warehouse(name).
async function seedOrderGraph(opts: {
  roadRunId: string;
  transportOrderId: string;
  customerName: string;
  customerPhone: string | null;
  pickupWarehouseName: string;
  deliveryWarehouseName: string;
  pickupArrived: string | null; // ISO or null
  deliveryArrived: string | null;
}): Promise<void> {
  const co = OP.companyId;
  const customerId = '00000000-0000-4000-8000-00000000c001';
  const pickupYardId = '00000000-0000-4000-8000-00000000a001';
  const deliveryYardId = '00000000-0000-4000-8000-00000000a002';
  const toId = opts.transportOrderId;
  const phoneVal = opts.customerPhone === null ? 'NULL' : q(opts.customerPhone);
  const operatorId = '00000000-0000-4000-8000-0000000d0001'.replace('d','b');
  const assetId = '00000000-0000-4000-8000-0000000e0001'.replace('e','c');
  const stmts = [
    'INSERT INTO road_run (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, assigned_operator_id, assigned_asset_id, planned_start_at) VALUES (' +
      q(opts.roadRunId) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q('planned') + ',' + q(operatorId) + ',' + q(assetId) + ',' + q('2026-05-24T08:00:00Z') + ')',
    'INSERT INTO customer (customer_id, company_id, business_unit_id, depot_id, legal_entity_id, name, phone) VALUES (' +
      q(customerId) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(opts.customerName) + ',' + phoneVal + ')',
    'INSERT INTO warehouse (warehouse_id, company_id, business_unit_id, depot_id, legal_entity_id, name, role) VALUES (' +
      q(pickupYardId) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(opts.pickupWarehouseName) + ',' + q('pickup') + ')',
    'INSERT INTO warehouse (warehouse_id, company_id, business_unit_id, depot_id, legal_entity_id, name, role) VALUES (' +
      q(deliveryYardId) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(opts.deliveryWarehouseName) + ',' + q('delivery') + ')',
    'INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, external_ref, state, customer_id) VALUES (' +
      q(toId) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q('XT.GRAPH') + ',' + q('assigned') + ',' + q(customerId) + ')',
    'INSERT INTO road_run_transport_order (road_run_transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, road_run_id, transport_order_id, sequence) VALUES (' +
      q('00000000-0000-4000-8000-000000040001') + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(opts.roadRunId) + ',' + q(toId) + ',1)',
  ];
  const pickupArr = opts.pickupArrived === null ? 'NULL' : q(opts.pickupArrived);
  const delivArr = opts.deliveryArrived === null ? 'NULL' : q(opts.deliveryArrived);
  stmts.push(
    'INSERT INTO stop (stop_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type, yard_id, arrived_at) VALUES (' +
      q('00000000-0000-4000-8000-000000050001') + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(toId) + ',1,' + q('pickup') + ',' + q(pickupYardId) + ',' + pickupArr + ')',
    'INSERT INTO stop (stop_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, sequence, stop_type, yard_id, arrived_at) VALUES (' +
      q('00000000-0000-4000-8000-000000050002') + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(toId) + ',2,' + q('delivery') + ',' + q(deliveryYardId) + ',' + delivArr + ')',
  );
  for (const s of stmts) await testDb.db.execute(sql.raw(s));
}
function headerOf(ws: ExcelJS.Worksheet): string[] {
  return (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v));
}
function rowValues(ws: ExcelJS.Worksheet, rowIdx: number): unknown[] {
  return (ws.getRow(rowIdx).values as unknown[]).slice(1);
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
    await testDb.db.execute(sql.raw('TRUNCATE TABLE road_run_transport_order CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE stop CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE transport_order CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE customer CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE warehouse CASCADE'));
  });
  it('header row is EXACTLY the 11 on-screen Lệnh điều xe columns in order', async () => {
    await seedProjection('aaaaaaaa-1111-4111-8111-111111111111', ['XT.1001']);
    const r = await svc.exportAndLog(OP, 'manual');
    expect(r.rowCount).toBe(1);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; if (!ws) throw new Error('no worksheet');
    expect(headerOf(ws)).toEqual(EXPECTED_HEADERS);
  });
  it('Khách hàng cell shows customer name + phone; stop slots show per-stop status', async () => {
    await seedProjection('aaaaaaaa-2222-4222-8222-222222222222', ['XT.GRAPH']);
    await seedOrderGraph({
      roadRunId: 'aaaaaaaa-2222-4222-8222-222222222222',
      transportOrderId: '00000000-0000-4000-8000-000000070001',
      customerName: 'ĐA NĂNG',
      customerPhone: '0903998784',
      pickupWarehouseName: 'Cần Thơ',
      deliveryWarehouseName: 'ĐA NĂNG',
      pickupArrived: '2026-05-24T10:00:00Z',
      deliveryArrived: null,
    });
    const r = await svc.exportAndLog(OP, 'manual');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; if (!ws) throw new Error('no worksheet');
    expect(headerOf(ws)).toEqual(EXPECTED_HEADERS);
    const data = rowValues(ws, 2);
    // col index (0-based after slice(1)): 0 Số lệnh,1 Khách hàng,2 Tài xế,3 Xe,
    // 4 Ngày dự kiến,5 Số điểm,6 Điểm nhận hàng 1,7..9 pickup2-4,10 Kho giao hàng 1
    expect(String(data[0])).toBe('XT.GRAPH');
    const kh = String(data[1]);
    expect(kh).toContain('ĐA NĂNG');
    expect(kh).toContain('0903998784');
    // pickup slot 1 has an arrived timestamp -> completed status
    expect(String(data[6])).toContain('Đã hoàn thành');
    // delivery slot 1 not arrived/departed -> Chưa tới
    expect(String(data[10])).toBe('Chưa tới');
    // unused pickup slots 2-4 -> em-dash
    expect(String(data[7])).toBe('—');
    expect(String(data[8])).toBe('—');
    expect(String(data[9])).toBe('—');
  });
  it('manual: inserts a ledger row with stable sha256 + canonical filename', async () => {
    await seedProjection('bbbbbbbb-1111-4111-8111-111111111111', ['XT.1002']);
    const r = await svc.exportAndLog(OP, 'manual');
    expect(r.filename).toMatch(/^lenh-dieu-xe_.+_\d{4}-\d{2}-\d{2}_manual_[a-f0-9]+\.xlsx$/);
    expect(r.sha256).toBe(createHash('sha256').update(r.buffer).digest('hex'));
    const logRows = await testDb.db.execute(sql.raw('SELECT trigger, row_count, sha256 FROM transport_order_export_log'));
    expect(logRows.rows).toHaveLength(1);
    expect((logRows.rows[0] as { trigger: string }).trigger).toBe('manual');
  });
  it('login: idempotent — second call same day returns the same ledger id', async () => {
    await seedProjection('cccccccc-1111-4111-8111-111111111111', ['XT.1003']);
    const a = await svc.exportAndLog(OP, 'login');
    const b = await svc.exportAndLog(OP, 'login');
    expect(b.exportLogId).toBe(a.exportLogId);
    const cnt = await testDb.db.execute<{ c: number }>(sql.raw("SELECT COUNT(*)::int AS c FROM transport_order_export_log WHERE trigger = 'login'"));
    expect((cnt.rows[0] as { c: number }).c).toBe(1);
  });
  it('logout: idempotent same day', async () => {
    await seedProjection('dddddddd-1111-4111-8111-111111111111', ['XT.1004']);
    await svc.exportAndLog(OP, 'logout');
    await svc.exportAndLog(OP, 'logout');
    const cnt = await testDb.db.execute<{ c: number }>(sql.raw("SELECT COUNT(*)::int AS c FROM transport_order_export_log WHERE trigger = 'logout'"));
    expect((cnt.rows[0] as { c: number }).c).toBe(1);
  });
  it('manual: NOT idempotent — two manual exports same day create two rows', async () => {
    await seedProjection('eeeeeeee-1111-4111-8111-111111111111', ['XT.1005']);
    await svc.exportAndLog(OP, 'manual');
    await svc.exportAndLog(OP, 'manual');
    const cnt = await testDb.db.execute<{ c: number }>(sql.raw("SELECT COUNT(*)::int AS c FROM transport_order_export_log WHERE trigger = 'manual'"));
    expect((cnt.rows[0] as { c: number }).c).toBe(2);
  });
  it('tenant scope: rows from another company are not exported', async () => {
    const otherCo = '00000000-0000-0000-0000-000000000bbb';
    const refsJson = JSON.stringify(['XT.OTHER']);
    const stmt =
      'INSERT INTO dispatch_board_projection ' +
      '(road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, ' +
      ' state, stop_count, transport_order_refs, server_seq, planned_start_at) ' +
      'VALUES (' + q('ffffffff-1111-4111-8111-111111111111') + ',' + q(otherCo) + ',' + q(otherCo) + ',' + q(otherCo) + ',' + q(otherCo) + ', ' +
      q('planned') + ',2,' + q(refsJson) + '::jsonb,1,' + q('2026-05-24T08:00:00Z') + ')';
    await testDb.db.execute(sql.raw(stmt));
    await seedProjection('99999999-1111-4111-8111-111111111111', ['XT.MINE']);
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
