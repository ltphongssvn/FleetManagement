// apps/api/test/order-number-seq.migration.integration.test.ts
// L5 RED -> GREEN: a fresh database with migrations applied must contain
// an order_sequence row for the pilot company with prefix='XTT',
// next_value=1, pad_width=3. The 2026-Q2 format change introduced the
// XTT.MM-NNN monthly numbering scheme; the timestamped XTT-monthly
// migration is the authoritative seed for freshly provisioned tenants
// so the allocator works out of the box without depending on the
// runtime reference-seed.
//
// Note: an older 'XT' row may coexist if the legacy migration also ran
// on this database (and was not removed); the assertion only requires
// that the XTT row exists with the correct pad_width.
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
const PILOT_COMPANY = '00000000-0000-0000-0000-000000000000';
let testDb: PgliteTestDb;
describe('@fleet/api - order_number_seq migration (T3, XTT.MM-NNN)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });
  it('ships a timestamp-named XTT-monthly migration', () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const match = files.filter((f) => f.endsWith('order_seq_xtt_monthly.sql'));
    expect(match.length).toBeGreaterThanOrEqual(1);
    expect(match[0]).toMatch(/^\d{8,}.*order_seq_xtt_monthly\.sql$/);
  });
  it('seeds order_sequence row for pilot company with XTT prefix and pad_width=3 after migrations', async () => {
    const q = String.fromCharCode(39);
    const stmt =
      'SELECT prefix, next_value, pad_width FROM order_sequence WHERE company_id = ' +
      q +
      PILOT_COMPANY +
      q +
      ' AND prefix = ' +
      q +
      'XTT' +
      q;
    const r = await testDb.db.execute<{ prefix: string; next_value: number; pad_width: number }>(
      sql.raw(stmt),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]?.prefix).toBe('XTT');
    expect(r.rows[0]?.next_value).toBe(1);
    expect(r.rows[0]?.pad_width).toBe(3);
  });
});
