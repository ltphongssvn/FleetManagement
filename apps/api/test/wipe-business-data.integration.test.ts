// apps/api/test/wipe-business-data.integration.test.ts
//
// L1 RED for wipeBusinessData() — 2026 CQRS best practice for 'fresh start'
// in a Command/Query split system:
//
//   PURGE: fact / event / read-model tables only. These can be rebuilt from
//          inputs (new dispatcher actions) and carry transaction state.
//          transport_order, road_run, road_run_transport_order, stop,
//          outbox, sync_change_feed, dispatch_board_projection,
//          projection_status, order_sequence, manifest, upload_session,
//          fleet_audit_log, transport_order_export_log, erp_invoice_map
//
//   PRESERVE: reference / master data tables. These represent the
//             dispatcher's persistent operational vocabulary
//             (Quản lý tài xế & xe, Quản lý dữ liệu điều phối):
//             driver, vehicle, customer, warehouse, cargo_type,
//             driver_vehicle_assignment, device_registry, device_session,
//             passkey_credential, erp_customer_map, erp_job_code_map,
//             spatial_ref_sys
//
// The migration bookkeeping table (drizzle's __drizzle_migrations, in the
// 'drizzle' schema, not 'public') must also be preserved.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { wipeBusinessData } from '../src/maintenance/wipe-business-data.js';

let testDb: PgliteTestDb;
const CO = '00000000-0000-0000-0000-000000000aaa';

const FACT_TABLES = [
  'transport_order', 'road_run', 'stop', 'road_run_transport_order',
  'dispatch_board_projection', 'outbox', 'transport_order_export_log',
  'fleet_audit_log', 'sync_change_feed', 'order_sequence',
] as const;

const REFERENCE_TABLES = [
  'driver', 'vehicle', 'customer', 'cargo_type', 'warehouse',
  'driver_vehicle_assignment',
] as const;

async function exec(q: string): Promise<void> { await testDb.db.execute(sql.raw(q)); }

async function countOne(t: string): Promise<number> {
  const r = await testDb.db.execute<{ c: number }>(sql.raw('SELECT COUNT(*)::int AS c FROM ' + t));
  return (r.rows[0] as { c: number }).c;
}

async function seedReferenceData(): Promise<void> {
  const sq = String.fromCharCode(39);
  await exec(
    'INSERT INTO vehicle (vehicle_id, company_id, business_unit_id, depot_id, legal_entity_id, plate, vehicle_type, active) ' +
    'VALUES (' + sq + '33333333-3333-4333-8333-333333333333' + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + 'PLATE1' + sq + ',' + sq + 'box_truck' + sq + ',true)'
  );
  await exec(
    'INSERT INTO driver (driver_id, company_id, business_unit_id, depot_id, legal_entity_id, full_name, operator_id, active) ' +
    'VALUES (' + sq + '11111111-1111-4111-8111-111111111111' + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + 'TEST DRIVER' + sq + ',' + sq + '22222222-2222-4222-8222-222222222222' + sq + ',true)'
  );
  await exec(
    'INSERT INTO customer (customer_id, company_id, business_unit_id, depot_id, legal_entity_id, name) ' +
    'VALUES (' + sq + '44444444-4444-4444-8444-444444444444' + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + 'TEST CUSTOMER' + sq + ')'
  );
  await exec(
    'INSERT INTO warehouse (warehouse_id, company_id, business_unit_id, depot_id, legal_entity_id, name) ' +
    'VALUES (' + sq + '55555555-5555-4555-8555-555555555555' + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + 'TEST WAREHOUSE' + sq + ')'
  );
  await exec(
    'INSERT INTO cargo_type (cargo_type_id, company_id, business_unit_id, depot_id, legal_entity_id, name) ' +
    'VALUES (' + sq + '66666666-6666-4666-8666-666666666666' + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + 'TEST CARGO' + sq + ')'
  );
  await exec(
    'INSERT INTO driver_vehicle_assignment (assignment_id, company_id, business_unit_id, depot_id, legal_entity_id, driver_id, vehicle_id) ' +
    'VALUES (' + sq + '77777777-7777-4777-8777-777777777777' + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + CO + sq + ',' + sq + '11111111-1111-4111-8111-111111111111' + sq + ',' + sq + '33333333-3333-4333-8333-333333333333' + sq + ')'
  );
}

async function seedFactData(): Promise<void> {
  const sq = String.fromCharCode(39);
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
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => stopPgliteTestDb(testDb));

  // Each test gets a clean slate. We TRUNCATE both fact and reference
  // tables directly (bypassing wipeBusinessData) so we can re-seed
  // deterministic ref data per test without violating PK constraints.
  beforeEach(async () => {
    const allTables = [...FACT_TABLES, ...REFERENCE_TABLES];
    const list = allTables.map((t) => '"' + t + '"').join(', ');
    await exec('TRUNCATE TABLE ' + list + ' RESTART IDENTITY CASCADE');
  });

  it('after wipe: every FACT table has zero rows', async () => {
    await seedReferenceData();
    await seedFactData();
    await wipeBusinessData(testDb.db as never);
    for (const t of FACT_TABLES) {
      const n = await countOne(t);
      if (n !== 0) throw new Error('fact table ' + t + ' should be empty but has ' + String(n) + ' rows');
      expect(n).toBe(0);
    }
  });

  it('after wipe: every REFERENCE table preserves its rows', async () => {
    await seedReferenceData();
    const before: Record<string, number> = {};
    for (const t of REFERENCE_TABLES) before[t] = await countOne(t);
    expect(before['driver']).toBeGreaterThan(0);
    expect(before['vehicle']).toBeGreaterThan(0);
    expect(before['customer']).toBeGreaterThan(0);
    expect(before['warehouse']).toBeGreaterThan(0);
    expect(before['cargo_type']).toBeGreaterThan(0);
    expect(before['driver_vehicle_assignment']).toBeGreaterThan(0);

    await wipeBusinessData(testDb.db as never);

    for (const t of REFERENCE_TABLES) {
      const after = await countOne(t);
      if (after !== before[t]) {
        throw new Error('reference table ' + t + ' must be preserved: before=' + String(before[t]) + ' after=' + String(after));
      }
      expect(after).toBe(before[t]);
    }
  });

  it('after wipe: drizzle migration bookkeeping is preserved', async () => {
    await wipeBusinessData(testDb.db as never);
    const r = await testDb.db.execute<{ c: number }>(sql.raw(
      'SELECT COUNT(*)::int AS c FROM drizzle.__drizzle_migrations'
    ));
    expect((r.rows[0] as { c: number }).c).toBeGreaterThan(0);
  });

  it('is idempotent: calling twice in a row succeeds and keeps reference data', async () => {
    await seedReferenceData();
    await seedFactData();
    const driversBefore = await countOne('driver');
    await wipeBusinessData(testDb.db as never);
    await wipeBusinessData(testDb.db as never);
    expect(await countOne('driver')).toBe(driversBefore);
    expect(await countOne('transport_order')).toBe(0);
  });

  it('a fresh insert after wipe succeeds (schema + constraints intact)', async () => {
    const sq = String.fromCharCode(39);
    await seedReferenceData();
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
