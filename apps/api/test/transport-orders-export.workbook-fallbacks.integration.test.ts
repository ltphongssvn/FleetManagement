// apps/api/test/transport-orders-export.workbook-fallbacks.integration.test.ts
//
// Branch coverage for buildWorkbook fallbacks (transport-orders-export.service.ts lines 182-183):
//   - transportOrderRefs[0] ?? DASH  (empty refs array)
//   - plannedStartAt ? format(...) : DASH  (null plannedStartAt)
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { TransportOrdersExportService } from '../src/transport-orders/transport-orders-export.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
let svc: TransportOrdersExportService;
const OP = createOperatorContext({ companyId: '00000000-0000-0000-0000-000000000aaa' });
const ROAD_RUN_ID = '44444444-4444-4444-8444-444444444444';
async function exec(q: string): Promise<void> { await testDb.db.execute(sql.raw(q)); }
describe('@fleet/api - export workbook fallbacks for empty refs and null plannedStartAt', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
    svc = new TransportOrdersExportService(testDb.db as never);
  });
  afterAll(async () => stopPgliteTestDb(testDb));
  it('renders em-dash in cells A and F when refs is empty and plannedStartAt is null', async () => {
    const co = OP.companyId;
    const sq = String.fromCharCode(39);
    await exec(
      'INSERT INTO dispatch_board_projection (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, stop_count, transport_order_refs, server_seq, planned_start_at, assigned_operator_id, assigned_asset_id) ' +
      'VALUES (' + sq + ROAD_RUN_ID + sq + ',' + sq + co + sq + ',' + sq + co + sq + ',' + sq + co + sq + ',' + sq + co + sq + ',' + sq + 'planned' + sq + ",0," + sq + '[]' + sq + "::jsonb,1,NULL,NULL,NULL)"
    );
    const r = await svc.exportAndLog(OP, 'manual');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('no worksheet');
    expect(ws.getRow(2).getCell(1).value).toBe('—'); // empty refs -> DASH
    expect(ws.getRow(2).getCell(6).value).toBe('—'); // null plannedStartAt -> DASH
  });
});
