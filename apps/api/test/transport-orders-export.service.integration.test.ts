// apps/api/test/transport-orders-export.service.integration.test.ts
//
// L4 contract for the export-backup feature. TransportOrdersExportService:
//   1) reads dispatch_board_projection scoped to companyId (DispatchController
//      scope rule), enriched at read time with the SAME joins the board uses:
//      customer name + phone (road_run_transport_order -> transport_order ->
//      customer) and per-stop warehouse (road_run_transport_order -> stop ->
//      warehouse);
//   2) produces an .xlsx whose first sheet is a DATA export (2026, Feature 2):
//      the 6 identifying columns, then per stop slot a PAIR of columns — the
//      warehouse NAME and the extracted net weight as a NUMBER (kg). NO per-stop
//      status text ('Chưa tới'/'Đã hoàn thành') and NO em-dash filler: a slot
//      with no stop, or a stop with no extracted weight yet, leaves the weight
//      cell EMPTY (blank, never 0) so spreadsheet SUM/AVERAGE over the column
//      stay correct (2026 missing-data export best practice).
//        Số lệnh | Khách hàng | Tài xế | Xe | Ngày dự kiến | Số điểm |
//        Điểm nhận hàng 1 | Điểm nhận hàng 1 - KL (kg) | ... (slots 2..4) |
//        Kho giao hàng 1 | Kho giao hàng 1 - KL (kg)
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
// Feature 2 (2026): per-slot warehouse-name + kg-number column PAIRS, no status.
const EXPECTED_HEADERS = [
  'Số lệnh', 'Khách hàng', 'Tài xế', 'Xe', 'Ngày dự kiến', 'Số điểm',
  'Điểm nhận hàng 1', 'Điểm nhận hàng 1 - KL (kg)',
  'Điểm nhận hàng 2', 'Điểm nhận hàng 2 - KL (kg)',
  'Điểm nhận hàng 3', 'Điểm nhận hàng 3 - KL (kg)',
  'Điểm nhận hàng 4', 'Điểm nhận hàng 4 - KL (kg)',
  'Kho giao hàng 1', 'Kho giao hàng 1 - KL (kg)',
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
async function seedOrderGraph(opts: {
  roadRunId: string;
  transportOrderId: string;
  customerName: string;
  customerPhone: string | null;
  pickupWarehouseName: string;
  deliveryWarehouseName: string;
  pickupArrived: string | null;
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
    await testDb.db.execute(sql.raw('TRUNCATE TABLE upload_session CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE manifest CASCADE'));
  });
  it('header row is EXACTLY the identifying columns + per-slot name/kg pairs', async () => {
    await seedProjection('aaaaaaaa-1111-4111-8111-111111111111', ['XT.1001']);
    const r = await svc.exportAndLog(OP, 'manual');
    expect(r.rowCount).toBe(1);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; if (!ws) throw new Error('no worksheet');
    expect(headerOf(ws)).toEqual(EXPECTED_HEADERS);
  });
  it('Khách hàng cell shows name + phone; stop slots show warehouse name + kg NUMBER, NO status text', async () => {
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
    // 0-based after slice(1): 0..5 identifying; then pairs:
    // 6 P1 name,7 P1 kg, 8 P2 name,9 P2 kg, 10 P3,11, 12 P4,13, 14 D1 name,15 D1 kg
    expect(String(data[0])).toBe('XT.GRAPH');
    const kh = String(data[1]);
    expect(kh).toContain('ĐA NĂNG');
    expect(kh).toContain('0903998784');
    // pickup slot 1: warehouse name present; NO status text anywhere in the row
    expect(String(data[6])).toBe('Cần Thơ');
    // delivery slot 1: warehouse name present
    expect(String(data[14])).toBe('ĐA NĂNG');
    // no weights extracted yet -> kg cells are EMPTY (blank), never 0, never status
    expect(data[7] === null || data[7] === undefined).toBe(true);
    expect(data[15] === null || data[15] === undefined).toBe(true);
    // unused pickup slots 2-4: both name and kg cells EMPTY (no em-dash, no status)
    for (const i of [8, 9, 10, 11, 12, 13]) {
      expect(data[i] === null || data[i] === undefined).toBe(true);
    }
    // explicit: the row contains NO legacy status strings anywhere
    const whole = data.map((v) => (typeof v === 'string' ? v : '')).join(' | ');
    expect(whole).not.toContain('Chưa tới');
    expect(whole).not.toContain('Đã hoàn thành');
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

  it('pickup slot shows the extracted net weight as a NUMBER in the paired kg column', async () => {
    const roadRunId = 'aaaaaaaa-7777-4777-8777-777777777777';
    const toId = '00000000-0000-4000-8000-000000077001';
    await seedProjection(roadRunId, ['XT.KG']);
    await seedOrderGraph({
      roadRunId,
      transportOrderId: toId,
      customerName: 'ĐẠI THÀNH',
      customerPhone: '0913998771',
      pickupWarehouseName: 'Cần Thơ',
      deliveryWarehouseName: 'ĐẠI THÀNH',
      pickupArrived: '2026-06-12T03:00:00Z',
      deliveryArrived: null,
    });
    const co = OP.companyId;
    const manifestId = '00000000-0000-4000-8000-0000000d0001';
    const sessionId = '00000000-0000-4000-8000-0000000e0001';
    const pickupStopId = '00000000-0000-4000-8000-000000050001';
    await testDb.db.execute(sql.raw(
      'INSERT INTO manifest (manifest_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, manifest_correlation_id, stop_id, state, extracted_net_weight_kg, extraction_status) VALUES (' +
      q(manifestId) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(toId) + ',' +
      q('00000000-0000-7000-8000-000000770001') + ',' + q(pickupStopId) + ',' + q('committed') + ',7920.000,' + q('extracted') + ')'
    ));
    await testDb.db.execute(sql.raw(
      'INSERT INTO upload_session (upload_session_id, company_id, business_unit_id, depot_id, legal_entity_id, manifest_id, operator_id, s3_key, s3_bucket, content_type, state) VALUES (' +
      q(sessionId) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(manifestId) + ',' +
      q('00000000-0000-4000-8000-0000000b0001') + ',' + q('manifests/x/y/z.jpg') + ',' + q('fleet-pilot-artifacts') + ',' + q('image/jpeg') + ',' + q('committed') + ')'
    ));
    const r = await svc.exportAndLog(OP, 'manual');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; if (!ws) throw new Error('no worksheet');
    // paired layout: col 7 = P1 name, col 8 = P1 kg number
    expect(ws.getRow(2).getCell(7).value).toBe('Cần Thơ');
    const kgCell = ws.getRow(2).getCell(8).value;
    expect(typeof kgCell).toBe('number');
    expect(kgCell).toBe(7920);
  });
});
