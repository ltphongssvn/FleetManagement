// apps/api/test/helpers/truncate-all-tables.test.ts
// RED-first: migrate-test-db must export truncateAllTables(db), a single
// atomic TRUNCATE over every public table. A single multi-table TRUNCATE
// statement makes Postgres acquire all AccessExclusiveLocks within one
// statement, eliminating the lock-ordering interleave that caused
// intermittent 40P01 deadlocks when many integration files truncate
// concurrently against the shared reused container.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  startMigratedTestDb, stopMigratedTestDb, truncateAllTables,
  type MigratedTestDb,
} from './migrate-test-db.js';
import { driver } from '../../src/database/schema/reference.js';

let testDb: MigratedTestDb;

describe('truncateAllTables', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_test');
    // The container is started with .withReuse(); a prior run of this file
    // may have left rows behind. Start from a known-clean state.
    await truncateAllTables(testDb.db);
  }, 90_000);

  afterAll(async () => {
    await stopMigratedTestDb(testDb);
  });

  it('removes all rows from a populated table', async () => {
    const companyId = '00000000-0000-0000-0000-000000000000';
    await testDb.db.insert(driver).values({
      companyId,
      businessUnitId: companyId,
      depotId: companyId,
      legalEntityId: companyId,
      fullName: 'Truncate Probe',
    });
    const before = await testDb.db.execute<{ count: string }>(
      sql.raw('SELECT COUNT(*)::text as count FROM driver'),
    );
    expect(Number(before.rows[0]?.count)).toBeGreaterThan(0);

    await truncateAllTables(testDb.db);

    const after = await testDb.db.execute<{ count: string }>(
      sql.raw('SELECT COUNT(*)::text as count FROM driver'),
    );
    expect(after.rows[0]?.count).toBe('0');
  });

  it('preserves the __drizzle_migrations bookkeeping table', async () => {
    await truncateAllTables(testDb.db);
    const migrations = await testDb.db.execute<{ count: string }>(
      sql.raw('SELECT COUNT(*)::text as count FROM drizzle.__drizzle_migrations'),
    );
    expect(Number(migrations.rows[0]?.count)).toBeGreaterThan(0);
  });

  it('is idempotent — truncating an already-empty database does not throw', async () => {
    await truncateAllTables(testDb.db);
    await expect(truncateAllTables(testDb.db)).resolves.toBeUndefined();
  });
});
