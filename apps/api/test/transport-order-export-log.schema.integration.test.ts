// apps/api/test/transport-order-export-log.schema.integration.test.ts
//
// L5 RED for export-backup feature: proves the transport_order_export_log
// table exists with the columns and unique constraint that enforce the
// daily-idempotent backup invariant.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  startPgliteTestDb,
  stopPgliteTestDb,
  type PgliteTestDb,
} from './helpers/pglite-test-db.js';
let testDb: PgliteTestDb;
const CO = '00000000-0000-0000-0000-000000000aaa';
const OP = '00000000-0000-0000-0000-000000000bbb';
describe('@fleet/api - transport_order_export_log schema (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => stopPgliteTestDb(testDb));
  it('table exists with the required audit columns', async () => {
    const r = await testDb.db.execute<{ column_name: string }>(
      sql.raw(
        'SELECT column_name FROM information_schema.columns WHERE table_name = ' +
          "'transport_order_export_log'",
      ),
    );
    const cols = r.rows.map((x) => x.column_name);
    expect(cols).toEqual(
      expect.arrayContaining([
        'export_log_id',
        'company_id',
        'operator_id',
        'trigger',
        'day_key',
        'row_count',
        'sha256',
        'filename',
        'created_at',
      ]),
    );
  });
  it('accepts a manual row insert', async () => {
    const q =
      'INSERT INTO transport_order_export_log ' +
      '(company_id, business_unit_id, depot_id, legal_entity_id, ' +
      ' operator_id, trigger, day_key, row_count, sha256, filename) ' +
      "VALUES ('" +
      CO +
      "','" +
      CO +
      "','" +
      CO +
      "','" +
      CO +
      "', " +
      "'" +
      OP +
      "','manual','2026-05-24',5,'abc123','f.xlsx')";
    await testDb.db.execute(sql.raw(q));
    const r = await testDb.db.execute<{ c: number }>(
      sql.raw("SELECT COUNT(*)::int AS c FROM transport_order_export_log WHERE trigger = 'manual'"),
    );
    expect((r.rows[0] as { c: number }).c).toBeGreaterThanOrEqual(1);
  });
  it('UNIQUE (company_id, operator_id, day_key, trigger) for auto triggers rejects duplicates same day', async () => {
    const ins = (trig: string): Promise<unknown> => {
      const q =
        'INSERT INTO transport_order_export_log ' +
        '(company_id, business_unit_id, depot_id, legal_entity_id, ' +
        ' operator_id, trigger, day_key, row_count, sha256, filename) ' +
        "VALUES ('" +
        CO +
        "','" +
        CO +
        "','" +
        CO +
        "','" +
        CO +
        "', " +
        "'" +
        OP +
        "','" +
        trig +
        "','2026-05-25',5,'h','f.xlsx')";
      return testDb.db.execute(sql.raw(q));
    };
    await ins('login');
    await expect(ins('login')).rejects.toThrow();
    await ins('logout');
    await expect(ins('logout')).rejects.toThrow();
  });
  it('CHECK constraint rejects trigger not in (manual, login, logout)', async () => {
    const q =
      'INSERT INTO transport_order_export_log ' +
      '(company_id, business_unit_id, depot_id, legal_entity_id, ' +
      ' operator_id, trigger, day_key, row_count, sha256, filename) ' +
      "VALUES ('" +
      CO +
      "','" +
      CO +
      "','" +
      CO +
      "','" +
      CO +
      "', " +
      "'" +
      OP +
      "','bogus','2026-05-26',5,'h','f.xlsx')";
    await expect(testDb.db.execute(sql.raw(q))).rejects.toThrow();
  });
});
