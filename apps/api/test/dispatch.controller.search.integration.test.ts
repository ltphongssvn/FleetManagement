// apps/api/test/dispatch.controller.search.integration.test.ts
// PGLite integration (RED-first) for FREE-TEXT SEARCH on the paginated board.
// Drives DispatchController.getBoardPage(op, { search }): a diacritic-insensitive
// term must filter the board by ANY searchable column, folded into the SAME
// WHERE that feeds COUNT + LIMIT/OFFSET so total/totalPages stay consistent with
// the returned slice. Mirrors dispatch.controller.pagination.integration.test.ts
// (real projection table + reference joins, real tenant filter). getBoardPage
// currently drops search (destructures only group/page/pageSize) => these fail.
//
// Searchable columns proven here: So lenh (transport_order_refs jsonb) and Tai xe
// (driver.full_name via the assigned_operator_id join, unaccent-insensitive).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { DispatchController } from '../src/dispatch/dispatch.controller.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: PgliteTestDb;
let ctrl: DispatchController;
const OP = createOperatorContext({ companyId: '00000000-0000-0000-0000-000000000aaa' });

function q1(v: string): string { return String.fromCharCode(39) + v + String.fromCharCode(39); }

// Seed a projection row. refsJson is a JSON array string for transport_order_refs
// (the So lenh column); operatorId optionally links a driver row for name search.
async function insertRow(roadRunId: string, state: string, plannedAt: string, refsJson: string, operatorId: string | null): Promise<void> {
  const co = OP.companyId;
  const opCol = operatorId === null ? 'NULL' : q1(operatorId);
  await testDb.db.execute(sql.raw(
    'INSERT INTO dispatch_board_projection ' +
    '(road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, stop_count, transport_order_refs, server_seq, planned_start_at, assigned_operator_id) ' +
    'VALUES (' +
    q1(roadRunId) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(co) + ', ' +
    q1(state) + ', 1, ' + q1(refsJson) + '::jsonb, 1, ' + q1(plannedAt) + ', ' + opCol + ')'
  ));
}

// Seed a driver row linked by operator_id (the board driverName join source).
async function insertDriver(operatorId: string, fullName: string): Promise<void> {
  const co = OP.companyId;
  await testDb.db.execute(sql.raw(
    'INSERT INTO driver ' +
    '(company_id, business_unit_id, depot_id, legal_entity_id, full_name, operator_id) ' +
    'VALUES (' + q1(co) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(fullName) + ', ' + q1(operatorId) + ')'
  ));
}
// Seed a transport_order (with a cargo_type) linked to a road run so the board
// cargo-name search join (road_run_transport_order -> transport_order ->
// cargo_type) has data. cargoName is the Ten hang the dispatcher searches.
async function insertOrderWithCargo(roadRunId: string, toId: string, cargoId: string, cargoName: string): Promise<void> {
  const co = OP.companyId;
  await testDb.db.execute(sql.raw(
    'INSERT INTO cargo_type (cargo_type_id, company_id, business_unit_id, depot_id, legal_entity_id, name) ' +
    'VALUES (' + q1(cargoId) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(cargoName) + ')'
  ));
  await testDb.db.execute(sql.raw(
    'INSERT INTO transport_order (transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, external_ref, customer_id, cargo_type_id, created_at, updated_at) ' +
    'VALUES (' + q1(toId) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1('XTT.06-900') + ', NULL, ' + q1(cargoId) + ', now(), now())'
  ));
  await testDb.db.execute(sql.raw(
    'INSERT INTO road_run (road_run_id, company_id, business_unit_id, depot_id, legal_entity_id, state, assigned_operator_id, assigned_asset_id) ' +
    'VALUES (' + q1(roadRunId) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1('planned') + ', ' + q1(co) + ', ' + q1(co) + ')'
  ));
  await testDb.db.execute(sql.raw(
    'INSERT INTO road_run_transport_order (road_run_id, transport_order_id, company_id, business_unit_id, depot_id, legal_entity_id, sequence) ' +
    'VALUES (' + q1(roadRunId) + ', ' + q1(toId) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(co) + ', ' + q1(co) + ', 1)'
  ));
}

function rr(n: number): string {
  return 'aaaaaaaa-1111-4111-8111-0000000000' + n.toString(16).padStart(2, '0');
}
function opid(n: number): string {
  return 'bbbbbbbb-2222-4222-8222-0000000000' + n.toString(16).padStart(2, '0');
}
function plannedAt(n: number): string {
  return '2026-06-' + n.toString().padStart(2, '0') + 'T08:00:00.000Z';
}

beforeAll(async () => {
  testDb = await startPgliteTestDb();
  ctrl = new DispatchController(testDb.db as never);
});
afterAll(async () => stopPgliteTestDb(testDb));
beforeEach(async () => {
  await testDb.db.execute(sql.raw('TRUNCATE TABLE dispatch_board_projection CASCADE'));
  await testDb.db.execute(sql.raw('TRUNCATE TABLE driver CASCADE'));
  await testDb.db.execute(sql.raw('TRUNCATE TABLE road_run_transport_order CASCADE'));
  await testDb.db.execute(sql.raw('TRUNCATE TABLE transport_order CASCADE'));
  await testDb.db.execute(sql.raw('TRUNCATE TABLE cargo_type CASCADE'));
  await testDb.db.execute(sql.raw('TRUNCATE TABLE road_run CASCADE'));
});

describe('@fleet/api - DispatchController.getBoardPage free-text search', () => {
  it('filters by transport order ref (So lenh) substring', async () => {
    await insertRow(rr(1), 'planned', plannedAt(1), '["XTT.07-019"]', null);
    await insertRow(rr(2), 'planned', plannedAt(2), '["XTT.07-020"]', null);
    const page = await ctrl.getBoardPage(OP, { group: 'active', page: 1, pageSize: 20, search: '07-019' });
    expect(page.total).toBe(1);
    expect(page.data[0]?.transportOrderRefs).toContain('XTT.07-019');
  });

  it('filters by driver name diacritic-insensitively (chau matches CHAU-with-marks)', async () => {
    await insertDriver(opid(1), 'LE VAN CHÂU');
    await insertDriver(opid(2), 'TRAN VAN BÌNH');
    await insertRow(rr(1), 'planned', plannedAt(1), '["TO-1"]', opid(1));
    await insertRow(rr(2), 'planned', plannedAt(2), '["TO-2"]', opid(2));
    const page = await ctrl.getBoardPage(OP, { group: 'active', page: 1, pageSize: 20, search: 'chau' });
    expect(page.total).toBe(1);
    expect(page.data[0]?.roadRunId).toBe(rr(1));
  });

  it('search narrows total/totalPages consistently with the returned slice', async () => {
    await insertRow(rr(1), 'planned', plannedAt(1), '["MATCH-1"]', null);
    await insertRow(rr(2), 'planned', plannedAt(2), '["MATCH-2"]', null);
    await insertRow(rr(3), 'planned', plannedAt(3), '["OTHER-3"]', null);
    const page = await ctrl.getBoardPage(OP, { group: 'active', page: 1, pageSize: 20, search: 'MATCH' });
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(1);
    expect(page.data).toHaveLength(2);
  });

  it('filters by cargo type name (Ten hang) diacritic-insensitively', async () => {
    await insertRow(rr(1), 'planned', plannedAt(1), '["TO-1"]', null);
    await insertRow(rr(2), 'planned', plannedAt(2), '["TO-2"]', null);
    await insertOrderWithCargo(rr(1), 'cae00000-1111-4111-8111-000000000001', 'cae00000-2222-4222-8222-000000000001', 'Gạo');
    const page = await ctrl.getBoardPage(OP, { group: 'active', page: 1, pageSize: 20, search: 'gao' });
    expect(page.total).toBe(1);
    expect(page.data[0]?.roadRunId).toBe(rr(1));
  });
  it('absent search returns all rows (back-compat)', async () => {
    await insertRow(rr(1), 'planned', plannedAt(1), '["TO-1"]', null);
    await insertRow(rr(2), 'planned', plannedAt(2), '["TO-2"]', null);
    const page = await ctrl.getBoardPage(OP, { group: 'active', page: 1, pageSize: 20 });
    expect(page.total).toBe(2);
  });
});
