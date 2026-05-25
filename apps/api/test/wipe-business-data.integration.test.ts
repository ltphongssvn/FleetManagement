// apps/api/test/wipe-business-data.integration.test.ts
//
// L1 RED for the dev/staging maintenance utility wipeBusinessData(): after
// running the wipe, all business tables must be empty. The migration
// bookkeeping table (drizzle's __drizzle_migrations, which lives in the
// 'drizzle' schema, not 'public') must be preserved so the database
// remains migrated. Single TRUNCATE statement: one AccessExclusiveLock
// acquisition over all named relations -> atomic, RESTART IDENTITY
// resets all sequences so the first new transport_order is XT.0001 again.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { wipeBusinessData } from '../src/maintenance/wipe-business-data.js';
let testDb: PgliteTestDb;
const CO = '00000000-0000-0000-0000-000000000aaa';
async function exec(q: string): Promise<void> { await testDb.db.execute(sql.raw(q)); }
async function countAll(): Promise<Record<string, number>> {
  const tables = [
    'transport_order', 'road_run', 'stop', 'road_run_transport_order',
    'dispatch_board_projection', 'outbox', 'transport_order_export_log',
    'driver', 'vehicle', 'customer', 'cargo_type', 'warehouse',
    'fleet_audit_log', 'sync_change_feed', 'driver_vehicle_assignment',
    'order_sequence',
  ];
  const out: Record<string, number> = {};
  for (const t of tables) {
    const r = await testDb.db.execute<{ c: number }>(sql.raw('SELECT COUNT(*)::int AS c FROM ' + t));
    out[t] = (r.rows[0] as { c: number }).c;
  }
  return out;
}
async function seedTestData(): Promise<void> {
  const sq = "'";
  await exec(
    'INSERT INTO vehicle (vehicle_id, company_id, business_unit_id, depot_id, legal_entity_id, plate, vehicle_type, active) ' +
    'VALUES (' + sq + '33333333-3333-4333-8333-333333333333' + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + 'PLATE1' + sq + ',' + sq + 'box_truck' + sq + ',true)'
  );
  await exec(
    'INSERT INTO driver (driver_id, company_id, business_unit_id, depot_id, legal_entity_id, full_name, operator_id, active) ' +
    'VALUES (' + sq + '11111111-1111-4111-8111-111111111111' + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + 'TEST DRIVER' + sq + ',' + sq + '22222222-2222-4222-8222-222222222222' + sq + ',true)'
  );
  await exec(
    'INSERT INTO order_sequence (company_id, business_unit_id, depot_id, legal_entity_id, prefix, next_value, pad_width) ' +
    'VALUES (' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + 'XT' + sq + ',99,4)'
  );
  await exec(
    'INSERT INTO transport_order_export_log (company_id, business_unit_id, depot_id, legal_entity_id, operator_id, trigger, day_key, row_count, sha256, filename) ' +
    'VALUES (' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + '22222222-2222-4222-8222-222222222222' + sq + ',' + sq + 'manual' + sq + ',' + sq + '2026-05-25' + sq + ',1,' + sq + 'h' + sq + ',' + sq + 'f.xlsx' + sq + ')'
  );
}
describe('@fleet/api - wipeBusinessData (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => stopPgliteTestDb(testDb));
  it('after wipe: every business table has zero rows', async () => {
    await seedTestData();
    const before = await countAll();
    expect(before['vehicle']).toBeGreaterThan(0);
    expect(before['driver']).toBeGreaterThan(0);
    expect(before['order_sequence']).toBeGreaterThan(0);
    expect(before['transport_order_export_log']).toBeGreaterThan(0);
    await wipeBusinessData(testDb.db as never);
    const after = await countAll();
    for (const [tbl, n] of Object.entries(after)) {
      if (n !== 0) throw new Error('table ' + tbl + ' should be empty but has ' + String(n) + ' rows');
      expect(n).toBe(0);
    }
  });
  it('after wipe: drizzle migration bookkeeping is preserved', async () => {
    await wipeBusinessData(testDb.db as never);
    const r = await testDb.db.execute<{ c: number }>(sql.raw(
      'SELECT COUNT(*)::int AS c FROM drizzle.__drizzle_migrations'
    ));
    expect((r.rows[0] as { c: number }).c).toBeGreaterThan(0);
  });
  it('is idempotent: calling twice in a row succeeds with no errors', async () => {
    await seedTestData();
    await wipeBusinessData(testDb.db as never);
    await wipeBusinessData(testDb.db as never);
    const after = await countAll();
    expect(after['driver']).toBe(0);
  });
  it('a fresh insert after wipe succeeds (schema + constraints intact)', async () => {
    const sq = "'";
    await seedTestData();
    await wipeBusinessData(testDb.db as never);
    await exec(
      'INSERT INTO vehicle (vehicle_id, company_id, business_unit_id, depot_id, legal_entity_id, plate, vehicle_type, active) ' +
      'VALUES (gen_random_uuid(),' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + 'POSTWIPE' + sq + ',' + sq + 'box_truck' + sq + ',true)'
    );
    const r = await testDb.db.execute<{ c: number }>(sql.raw(
      'SELECT COUNT(*)::int AS c FROM vehicle WHERE plate = ' + sq + 'POSTWIPE' + sq
    ));
    expect((r.rows[0] as { c: number }).c).toBe(1);
  });
});
