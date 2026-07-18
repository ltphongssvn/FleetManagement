// apps/api/test/transport-orders-export.labels.integration.test.ts
//
// L4 RED for export-labels fix: the .xlsx must show driver full_name and
// vehicle plate, never raw UUIDs. Same invariant as DispatchBoard's
// labels.ts (em-dash on miss, no hash slice leak).
//
// Tests join behavior at the service layer because the resolution is
// authoritative there — the worksheet renderer just receives strings.
// Verification reads cells back with ExcelJS and asserts they match
// the seeded human-readable values, not the seeded UUIDs.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { TransportOrdersExportService } from '../src/transport-orders/transport-orders-export.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
let svc: TransportOrdersExportService;
const OP = createOperatorContext({ companyId: '00000000-0000-0000-0000-000000000aaa' });
const DRIVER_ID = '11111111-1111-4111-8111-111111111111';
const DRIVER_OP_ID = '22222222-2222-4222-8222-222222222222';
const VEHICLE_ID = '33333333-3333-4333-8333-333333333333';
const ROAD_RUN_ID = '44444444-4444-4444-8444-444444444444';
async function exec(q: string): Promise<void> { await testDb.db.execute(sql.raw(q)); }
async function seed(): Promise<void> {
  const co = OP.companyId;
  await exec(
    "INSERT INTO driver (driver_id, company_id, business_unit_id, depot_id, legal_entity_id, full_name, operator_id, active) " +
    "VALUES ('" + DRIVER_ID + "','" + co + "','" + co + "','" + co + "','" + co + "','NGUYỄN VĂN A','" + DRIVER_OP_ID + "',true)"
  );
  await exec(
    "INSERT INTO vehicle (vehicle_id, company_id, business_unit_id, depot_id, legal_entity_id, plate, vehicle_type, active) " +
    "VALUES ('" + VEHICLE_ID + "','" + co + "','" + co + "','" + co + "','" + co + "','51C 12345','box_truck',true)"
  );
  await exec(
    "INSERT INTO dispatch_board_projection (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, stop_count, transport_order_refs, server_seq, planned_start_at, assigned_operator_id, assigned_asset_id) " +
    "VALUES ('" + ROAD_RUN_ID + "','" + co + "','" + co + "','" + co + "','" + co + "','planned',2,'[" + String.fromCharCode(34) + "XT.0001" + String.fromCharCode(34) + "]'::jsonb,1,'2026-05-24T08:00:00Z','" + DRIVER_OP_ID + "','" + VEHICLE_ID + "')"
  );
}
describe('@fleet/api - export worksheet shows labels, not UUIDs', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    svc = new TransportOrdersExportService(testDb.db as never);
  });
  afterAll(async () => stopPgliteTestDb(testDb));
  beforeEach(async () => {
    await exec('TRUNCATE TABLE dispatch_board_projection CASCADE');
    await exec('TRUNCATE TABLE transport_order_export_log CASCADE');
    await exec('TRUNCATE TABLE driver CASCADE');
    await exec('TRUNCATE TABLE vehicle CASCADE');
  });
  it('renders driver full_name (not operator_id UUID) in column D', async () => {
    await seed();
    const r = await svc.exportAndLog(OP, 'manual');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; if (!ws) throw new Error('no worksheet');
    const driverCell = ws.getRow(2).getCell(4).value;
    expect(driverCell).toBe('NGUYỄN VĂN A');
    expect(driverCell as string).not.toContain(DRIVER_OP_ID);
  });
  it('renders vehicle plate (not vehicle_id UUID) in column E', async () => {
    await seed();
    const r = await svc.exportAndLog(OP, 'manual');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; if (!ws) throw new Error('no worksheet');
    const vehicleCell = ws.getRow(2).getCell(5).value;
    expect(vehicleCell).toBe('51C 12345');
    expect(vehicleCell as string).not.toContain(VEHICLE_ID);
  });
  it('falls back to em-dash when driver row is missing (defensive)', async () => {
    const co = OP.companyId;
    await exec(
      "INSERT INTO vehicle (vehicle_id, company_id, business_unit_id, depot_id, legal_entity_id, plate, vehicle_type, active) " +
      "VALUES ('" + VEHICLE_ID + "','" + co + "','" + co + "','" + co + "','" + co + "','51C 99999','box_truck',true)"
    );
    await exec(
      "INSERT INTO dispatch_board_projection (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, stop_count, transport_order_refs, server_seq, planned_start_at, assigned_operator_id, assigned_asset_id) " +
      "VALUES ('" + ROAD_RUN_ID + "','" + co + "','" + co + "','" + co + "','" + co + "','planned',1,'[" + String.fromCharCode(34) + "XT.0002" + String.fromCharCode(34) + "]'::jsonb,1,'2026-05-24T08:00:00Z','" + DRIVER_OP_ID + "','" + VEHICLE_ID + "')"
    );
    const r = await svc.exportAndLog(OP, 'manual');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; if (!ws) throw new Error('no worksheet');
    expect(ws.getRow(2).getCell(4).value).toBe('—');
    expect(ws.getRow(2).getCell(5).value).toBe('51C 99999');
  });
  it('falls back to em-dash for null assigned_operator_id and assigned_asset_id', async () => {
    const co = OP.companyId;
    await exec(
      "INSERT INTO dispatch_board_projection (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, stop_count, transport_order_refs, server_seq, planned_start_at, assigned_operator_id, assigned_asset_id) " +
      "VALUES ('" + ROAD_RUN_ID + "','" + co + "','" + co + "','" + co + "','" + co + "','planned',1,'[" + String.fromCharCode(34) + "XT.0003" + String.fromCharCode(34) + "]'::jsonb,1,'2026-05-24T08:00:00Z',NULL,NULL)"
    );
    const r = await svc.exportAndLog(OP, 'manual');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]; if (!ws) throw new Error('no worksheet');
    expect(ws.getRow(2).getCell(4).value).toBe('—');
    expect(ws.getRow(2).getCell(5).value).toBe('—');
  });
});
