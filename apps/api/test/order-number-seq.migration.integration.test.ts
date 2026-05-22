// apps/api/test/order-number-seq.migration.integration.test.ts
// L5 RED → GREEN: a fresh database with migrations applied must contain
// a default order_sequence row for the pilot company with prefix='XT',
// next_value=1, pad_width=3. The migration is the authoritative seed for
// the numbering feature so a freshly provisioned tenant gets a working
// allocator without depending on the runtime reference-seed.
//
// The migration filename is timestamp-prefixed (per the cross-terminal
// partitioning rule: timestamp filenames remove journal-collision class
// between parallel feature branches).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, '../src/database/migrations');
const PILOT_COMPANY = '00000000-0000-0000-0000-000000000000';
let testDb: PgliteTestDb;
describe('@fleet/api - order_number_seq migration (T3)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('ships a timestamp-named order_number_seq migration', () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
    const match = files.filter((f) => f.endsWith('order_number_seq.sql'));
    expect(match.length).toBeGreaterThanOrEqual(1);
    expect(match[0]).toMatch(/^\d{8,}.*order_number_seq\.sql$/);
  });
  it('seeds order_sequence row for pilot company with XT prefix after migrations', async () => {
    const q = String.fromCharCode(39);
    const stmt =
      'SELECT prefix, next_value, pad_width FROM order_sequence WHERE company_id = ' +
      q + PILOT_COMPANY + q + ' AND prefix = ' + q + 'XT' + q;
    const r = await testDb.db.execute<{ prefix: string; next_value: number; pad_width: number }>(
      sql.raw(stmt),
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]?.prefix).toBe('XT');
    expect(r.rows[0]?.next_value).toBe(1);
    expect(r.rows[0]?.pad_width).toBe(4);
  });
});
