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
import type { ExportDateRange } from '@fleet/sync-protocol';
import { LENH_DIEU_XE_EXPORT_HEADERS } from '@fleet/sync-protocol';
let testDb: PgliteTestDb;
let svc: TransportOrdersExportService;
const OP = createOperatorContext({ companyId: '00000000-0000-0000-0000-000000000aaa' });
// The header contract is the provider-owned SSOT in @fleet/sync-protocol; this test
// imports it instead of re-declaring the array, so it cannot drift from what the
// service writes. (Asserting the imported value still proves the service emits it.)
const EXPECTED_HEADERS = LENH_DIEU_XE_EXPORT_HEADERS;
function q(s: string): string { return String.fromCharCode(39) + s + String.fromCharCode(39); }
async function seedProjection(roadRunId: string, refs: readonly string[], state = 'planned'): Promise<void> {
  const co = OP.companyId;
  const refsJson = JSON.stringify(refs);
  const stmt =
    'INSERT INTO dispatch_board_projection ' +
    '(road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, ' +
    ' state, stop_count, transport_order_refs, server_seq, planned_start_at) ' +
    'VALUES (' + q(roadRunId) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ', ' +
    q(state) + ',2,' + q(refsJson) + '::jsonb,1,' + q('2026-05-24T08:00:00Z') + ')';
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
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    svc = new TransportOrdersExportService(testDb.db as never);
  });
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

describe('@fleet/api - TransportOrdersExportService (integration)', () => {
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
    // 0-based after slice(1): 0 Số lệnh, 1 Trạng thái, 2 Khách hàng, 3 Tài xế,
    // 4 Xe, 5 Ngày dự kiến, 6 Số điểm, 7 = Chênh lệch; then pairs:
    // 8 P1 name,9 P1 kg, 10 P2 name,11 P2 kg, 12 P3,13, 14 P4,15, 16 D1 name,17 D1 kg
    expect(String(data[0])).toBe('XT.GRAPH');
    // Trạng thái is blank for a non-cancelled (planned) order.
    expect(data[1] === null || data[1] === undefined).toBe(true);
    const kh = String(data[2]);
    expect(kh).toContain('ĐA NĂNG');
    expect(kh).toContain('0903998784');
    // pickup slot 1: warehouse name present; NO status text anywhere in the row
    // Chênh lệch (col 7) is BLANK here: only the pickup is seeded with no weight,
    // so the diff is incomplete -> true blank, never 0.
    expect(data[7] === null || data[7] === undefined).toBe(true);
    expect(String(data[8])).toBe('Cần Thơ');
    // delivery slot 1: warehouse name present
    expect(String(data[16])).toBe('ĐA NĂNG');
    // no weights extracted yet -> kg cells are EMPTY (blank), never 0, never status
    expect(data[9] === null || data[9] === undefined).toBe(true);
    expect(data[17] === null || data[17] === undefined).toBe(true);
    // unused pickup slots 2-4: both name and kg cells EMPTY (no em-dash, no status)
    for (const i of [10, 11, 12, 13, 14, 15]) {
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
    // With Trạng thái inserted at col 2, the layout shifts by 1 more: col 8 =
    // Chênh lệch; col 9 = P1 name, col 10 = P1 kg.
    expect(ws.getRow(2).getCell(9).value).toBe('Cần Thơ');
    const kgCell = ws.getRow(2).getCell(10).value;
    expect(typeof kgCell).toBe('number');
    expect(kgCell).toBe(7920);
  });

  // Feature 3 export parity: the board shows a Chenh lech (pickup-vs-delivery
  // net-weight difference) column; the export MUST carry the same value, computed
  // by the shared @fleet/sync-protocol computeWeightDiffKg SSOT. Here pickup
  // 5000 - pickup 7920 = -2920, emitted as a NUMBER in the Chenh lech column.
  it('emits a Chênh lệch column with the numeric delivery-minus-pickup weight diff', async () => {
    const roadRunId = 'aaaaaaaa-8888-4888-8888-888888888888';
    const toId = '00000000-0000-4000-8000-000000088001';
    await seedProjection(roadRunId, ['XT.DIFF']);
    await seedOrderGraph({
      roadRunId,
      transportOrderId: toId,
      customerName: 'ĐẠI THÀNH',
      customerPhone: '0913998773',
      pickupWarehouseName: 'Cần Thơ',
      deliveryWarehouseName: 'ĐẠI THÀNH',
      pickupArrived: '2026-06-12T03:00:00Z',
      deliveryArrived: '2026-06-12T09:00:00Z',
    });
    const co = OP.companyId;
    const pickupStopId = '00000000-0000-4000-8000-000000050001';
    const deliveryStopId = '00000000-0000-4000-8000-000000050002';
    // pickup manifest: 7920 kg committed+extracted on the pickup stop
    await testDb.db.execute(sql.raw(
      'INSERT INTO manifest (manifest_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, manifest_correlation_id, stop_id, state, extracted_net_weight_kg, extraction_status) VALUES (' +
      q('00000000-0000-4000-8000-0000000d8001') + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(toId) + ',' +
      q('00000000-0000-7000-8000-000000780001') + ',' + q(pickupStopId) + ',' + q('committed') + ',7920.000,' + q('extracted') + ')'
    ));
    await testDb.db.execute(sql.raw(
      'INSERT INTO upload_session (upload_session_id, company_id, business_unit_id, depot_id, legal_entity_id, manifest_id, operator_id, s3_key, s3_bucket, content_type, state) VALUES (' +
      q('00000000-0000-4000-8000-0000000e8001') + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q('00000000-0000-4000-8000-0000000d8001') + ',' +
      q('00000000-0000-4000-8000-0000000b8001') + ',' + q('manifests/x/y/p.jpg') + ',' + q('fleet-pilot-artifacts') + ',' + q('image/jpeg') + ',' + q('committed') + ')'
    ));
    // delivery manifest: 5000 kg committed+extracted on the delivery stop
    await testDb.db.execute(sql.raw(
      'INSERT INTO manifest (manifest_id, company_id, business_unit_id, depot_id, legal_entity_id, transport_order_id, manifest_correlation_id, stop_id, state, extracted_net_weight_kg, extraction_status) VALUES (' +
      q('00000000-0000-4000-8000-0000000d8002') + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(toId) + ',' +
      q('00000000-0000-7000-8000-000000780002') + ',' + q(deliveryStopId) + ',' + q('committed') + ',5000.000,' + q('extracted') + ')'
    ));
    await testDb.db.execute(sql.raw(
      'INSERT INTO upload_session (upload_session_id, company_id, business_unit_id, depot_id, legal_entity_id, manifest_id, operator_id, s3_key, s3_bucket, content_type, state) VALUES (' +
      q('00000000-0000-4000-8000-0000000e8002') + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q(co) + ',' + q('00000000-0000-4000-8000-0000000d8002') + ',' +
      q('00000000-0000-4000-8000-0000000b8002') + ',' + q('manifests/x/y/d.jpg') + ',' + q('fleet-pilot-artifacts') + ',' + q('image/jpeg') + ',' + q('committed') + ')'
    ));
    const r = await svc.exportAndLog(OP, 'manual');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; if (!ws) throw new Error('no worksheet');
    const headers = headerOf(ws);
    expect(headers).toContain('Chênh lệch (Số giao - Số nhận)');
    const diffCol = headers.indexOf('Chênh lệch (Số giao - Số nhận)');
    // Chênh lệch sits right after Số điểm; with Trạng thái inserted at index 1
    // the identifying block is Số lệnh(0) Trạng thái(1) Khách hàng(2) Tài xế(3)
    // Xe(4) Ngày dự kiến(5) Số điểm(6) Chênh lệch(7), before the stop pairs.
    expect(diffCol).toBe(7);
    const cell = ws.getRow(2).getCell(diffCol + 1).value;
    expect(typeof cell).toBe('number');
    expect(cell).toBe(-2920);
  });
  // Feature (2026): the owner wants to see which orders are cancelled in the
  // exported workbook. A dedicated Trạng thái column shows Đã hủy for a
  // cancelled road run and a true blank for any other state, mirroring the
  // on-screen board badge (the state lives on dispatch_board_projection.state).
  it('Trạng thái column shows Đã hủy for a cancelled order and blank otherwise', async () => {
    await seedProjection('aaaaaaaa-9999-4999-8999-999999999999', ['XT.CANCELLED'], 'cancelled');
    await seedProjection('bbbbbbbb-9999-4999-8999-999999999999', ['XT.PLANNED'], 'planned');
    const r = await svc.exportAndLog(OP, 'manual');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; if (!ws) throw new Error('no worksheet');
    const headers = headerOf(ws);
    expect(headers).toContain('Trạng thái');
    const statusCol = headers.indexOf('Trạng thái');
    // Trạng thái is the second column (right after Số lệnh).
    expect(statusCol).toBe(1);
    // Collect the Số lệnh + Trạng thái pair for every data row, order-independent.
    const byRef = new Map<string, unknown>();
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const ref = row.getCell(1).value;
      const status = row.getCell(statusCol + 1).value;
      if (typeof ref === 'string') byRef.set(ref, status);
    });
    expect(byRef.get('XT.CANCELLED')).toBe('Đã hủy');
    const plannedStatus = byRef.get('XT.PLANNED');
    expect(plannedStatus === null || plannedStatus === undefined).toBe(true);
  });
});


// --- Feature 4 (2026): dispatcher-selectable export day-range (VN tz) ---
// The manual export accepts an optional inclusive [from, to] range of VN-local
// calendar dates and exports only road runs whose planned_start_at falls in that
// window IN VIETNAM TIME (UTC+7), proven by a boundary row whose UTC instant is
// the previous day in UTC but the next day in VN.
describe('@fleet/api - export day-range filter (Feature 4)', () => {
  function qq(v: string): string { return String.fromCharCode(39) + v + String.fromCharCode(39); }
  async function seedAt(roadRunId: string, ref: string, plannedUtc: string): Promise<void> {
    const co = OP.companyId;
    const refsJson = JSON.stringify([ref]);
    await testDb.db.execute(sql.raw(
      'INSERT INTO dispatch_board_projection ' +
      '(road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, stop_count, transport_order_refs, server_seq, planned_start_at) ' +
      'VALUES (' + qq(roadRunId) + ',' + qq(co) + ',' + qq(co) + ',' + qq(co) + ',' + qq(co) + ',' + qq('planned') + ',1,' + qq(refsJson) + '::jsonb,1,' + qq(plannedUtc) + ')'
    ));
  }
  async function refsInWorkbook(buffer: Buffer): Promise<string[]> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; if (!ws) throw new Error('no worksheet');
    const out: string[] = [];
    ws.eachRow((row, idx) => { if (idx > 1) { const v = row.getCell(1).value; if (typeof v === 'string') out.push(v); } });
    return out.sort();
  }
  beforeEach(async () => {
    await testDb.db.execute(sql.raw('TRUNCATE TABLE dispatch_board_projection CASCADE'));
    await testDb.db.execute(sql.raw('TRUNCATE TABLE transport_order_export_log CASCADE'));
  });

  it('exports only road runs whose VN-local planned date is within [from, to]', async () => {
    await seedAt('a0000000-1111-4111-8111-000000000001', 'XT.D10', '2026-05-10T02:00:00Z');
    await seedAt('a0000000-1111-4111-8111-000000000002', 'XT.D15', '2026-05-15T02:00:00Z');
    await seedAt('a0000000-1111-4111-8111-000000000003', 'XT.D20', '2026-05-20T02:00:00Z');
    const range: ExportDateRange = { from: '2026-05-10', to: '2026-05-15' };
    const r = await svc.exportAndLog(OP, 'manual', range);
    expect(await refsInWorkbook(r.buffer)).toEqual(['XT.D10', 'XT.D15']);
    expect(r.rowCount).toBe(2);
  });

  it('uses VN time (UTC+7) for the boundary, not UTC', async () => {
    // 2026-05-20T18:00:00Z is 2026-05-21 01:00 in Vietnam -> VN date 2026-05-21,
    // which is OUTSIDE [2026-05-10, 2026-05-20] even though the UTC date is 05-20.
    await seedAt('a0000000-2222-4222-8222-000000000001', 'XT.VNEDGE', '2026-05-20T18:00:00Z');
    // A row clearly inside the window for contrast.
    await seedAt('a0000000-2222-4222-8222-000000000002', 'XT.INSIDE', '2026-05-12T05:00:00Z');
    const range: ExportDateRange = { from: '2026-05-10', to: '2026-05-20' };
    const r = await svc.exportAndLog(OP, 'manual', range);
    expect(await refsInWorkbook(r.buffer)).toEqual(['XT.INSIDE']);
  });

  it('with no range, exports all rows (unchanged behavior)', async () => {
    await seedAt('a0000000-3333-4333-8333-000000000001', 'XT.ALL1', '2026-05-10T02:00:00Z');
    await seedAt('a0000000-3333-4333-8333-000000000002', 'XT.ALL2', '2026-09-01T02:00:00Z');
    const r = await svc.exportAndLog(OP, 'manual');
    expect(await refsInWorkbook(r.buffer)).toEqual(['XT.ALL1', 'XT.ALL2']);
  });
});
