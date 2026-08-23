// apps/api/test/transport-order-cancellation-audit.migration.integration.test.ts
// L6 RED → GREEN for T5: a fresh database with migrations applied must add
// four cancellation audit columns to transport_order and a check constraint
// that makes 'cancelled' state without cancelled_at impossible at the DB
// level. This is the deepest defense layer behind the service-level FSM
// guard and the controller-level DTO.
//
// Audit fields (2026 soft-state-transition pattern, see Oracle order log,
// Google OrderState, Trysil change-tracking pattern):
//   cancelled_at         timestamptz NULL   (set when state -> cancelled)
//   cancelled_by         uuid        NULL   (operator who cancelled)
//   cancellation_reason  varchar(64) NULL   (enum-like, validated at DTO)
//   cancellation_note    varchar(500) NULL  (optional free-text)
//
// Constraint:
//   transport_order_cancelled_audit_consistent:
//     state <> 'cancelled' OR cancelled_at IS NOT NULL
//
// The migration filename is timestamp-prefixed per the cross-terminal
// partitioning rule (timestamp filenames remove journal collision class
// between parallel feature branches).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startPgliteTestDb,
  stopPgliteTestDb,
  type PgliteTestDb,
} from './helpers/pglite-test-db.js';
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../src/database/migrations');
let testDb: PgliteTestDb;
describe('@fleet/api - transport_order_cancellation_audit migration (T5)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });
  it('ships a timestamp-named transport_order_cancellation_audit migration', () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const match = files.filter((f) => f.endsWith('transport_order_cancellation_audit.sql'));
    expect(match.length).toBeGreaterThanOrEqual(1);
    expect(match[0]).toMatch(/^\d{8,}.*transport_order_cancellation_audit\.sql$/);
  });
  it('adds cancelled_at, cancelled_by, cancellation_reason, cancellation_note columns to transport_order', async () => {
    const q = String.fromCharCode(39);
    const stmt =
      'SELECT column_name, data_type, is_nullable FROM information_schema.columns ' +
      'WHERE table_name = ' +
      q +
      'transport_order' +
      q +
      ' AND column_name IN (' +
      q +
      'cancelled_at' +
      q +
      ', ' +
      q +
      'cancelled_by' +
      q +
      ', ' +
      q +
      'cancellation_reason' +
      q +
      ', ' +
      q +
      'cancellation_note' +
      q +
      ') ORDER BY column_name';
    const r = await testDb.db.execute<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(sql.raw(stmt));
    const names = r.rows.map((row) => row.column_name).sort();
    expect(names).toEqual([
      'cancellation_note',
      'cancellation_reason',
      'cancelled_at',
      'cancelled_by',
    ]);
    for (const row of r.rows) {
      expect(row.is_nullable).toBe('YES');
    }
  });
  it('enforces transport_order_cancelled_audit_consistent: state=cancelled without cancelled_at is rejected', async () => {
    const q = String.fromCharCode(39);
    const zero = q + '00000000-0000-0000-0000-000000000000' + q;
    const insertNoAudit =
      'INSERT INTO transport_order (company_id, business_unit_id, depot_id, legal_entity_id, state) ' +
      'VALUES (' +
      zero +
      ',' +
      zero +
      ',' +
      zero +
      ',' +
      zero +
      ',' +
      q +
      'cancelled' +
      q +
      ')';
    await expect(testDb.db.execute(sql.raw(insertNoAudit))).rejects.toThrow();
  });
  it('permits a non-cancelled order to be inserted without any audit fields (constraint only fires on cancelled state)', async () => {
    const q = String.fromCharCode(39);
    const zero = q + '00000000-0000-0000-0000-000000000000' + q;
    const insertDraft =
      'INSERT INTO transport_order (company_id, business_unit_id, depot_id, legal_entity_id, state) ' +
      'VALUES (' +
      zero +
      ',' +
      zero +
      ',' +
      zero +
      ',' +
      zero +
      ',' +
      q +
      'draft' +
      q +
      ') RETURNING transport_order_id';
    const r = await testDb.db.execute<{ transport_order_id: string }>(sql.raw(insertDraft));
    expect(r.rows.length).toBe(1);
  });
});
