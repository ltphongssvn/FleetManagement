// apps/api/test/migrations.integration.test.ts
// Round-trip test: drizzle migrations apply cleanly to a PRISTINE Postgres
// database and produce the expected tables + enums.
//
// Unlike every other integration spec, this one must run migrations against an
// UN-migrated database (that is the thing under test), so it cannot clone the
// already-migrated fleet_test_template. It also must NOT construct its own
// container (the single-shared-container guard forbids it). Instead it creates a
// fresh EMPTY database on the SHARED container (CREATE DATABASE with no TEMPLATE
// => clones the empty template0/template1, i.e. pristine), migrates into it, and
// drops it afterward.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inject } from 'vitest';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestPgConnectionSchema, TEST_PG_INJECT_KEY } from './helpers/test-pg-connection-contract.js';
import { EXTRACTION_FAILURE_REASONS } from '@fleet/sync-protocol';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../src/database/migrations');

const MIGRATE_TEST_DB = 'fleet_migrate_test';

function quoteIdent(name: string): string {
  const dq = String.fromCharCode(34);
  return dq + name.split(dq).join(dq + dq) + dq;
}

function uriFor(database: string): string {
  const c = TestPgConnectionSchema.parse(inject(TEST_PG_INJECT_KEY));
  return 'postgres://' + c.user + ':' + c.password + '@' + c.host + ':' + String(c.port) + '/' + database;
}

let pool: Pool | undefined;
let db: NodePgDatabase;

describe('@fleet/api - drizzle migrations apply to fresh Postgres', () => {
  beforeAll(async () => {
    const injected = TestPgConnectionSchema.parse(inject(TEST_PG_INJECT_KEY));
    // Create a pristine empty database on the shared container (no TEMPLATE =>
    // empty). Drop any leftover from a prior reused-container run first.
    const admin = new Pool({ connectionString: uriFor(injected.database), connectionTimeoutMillis: 10_000 });
    try {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [MIGRATE_TEST_DB],
      );
      await admin.query('DROP DATABASE IF EXISTS ' + quoteIdent(MIGRATE_TEST_DB));
      await admin.query('CREATE DATABASE ' + quoteIdent(MIGRATE_TEST_DB));
    } finally {
      await admin.end();
    }
    pool = new Pool({ connectionString: uriFor(MIGRATE_TEST_DB), connectionTimeoutMillis: 10_000 });
    db = drizzle(pool);
  });

  afterAll(async () => {
    if (pool !== undefined) await pool.end();
    const injected = TestPgConnectionSchema.parse(inject(TEST_PG_INJECT_KEY));
    const admin = new Pool({ connectionString: uriFor(injected.database), connectionTimeoutMillis: 10_000 });
    try {
      await admin.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
        [MIGRATE_TEST_DB],
      );
      await admin.query('DROP DATABASE IF EXISTS ' + quoteIdent(MIGRATE_TEST_DB));
    } finally {
      await admin.end();
    }
  });

  it('runs all migrations without error', async () => {
    await expect(migrate(db, { migrationsFolder })).resolves.toBeUndefined();
  }, 60_000);

  it('creates all PDF-mandated tables', async () => {
    const result = await db.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const tables = new Set(result.rows.map((r) => r.tablename));
    for (const expected of [
      'transport_order',
      'stop',
      'road_run',
      'road_run_transport_order',
      'manifest',
      'upload_session',
      'erp_customer_map',
      'erp_job_code_map',
      'erp_invoice_map',
      'sync_change_feed',
      'outbox',
      'device_registry',
      'device_session',
      'fleet_audit_log',
    ]) {
      expect(tables.has(expected)).toBe(true);
    }
  });

  it('creates all PDF-mandated enums', async () => {
    const result = await db.execute<{ typname: string }>(
      sql`SELECT typname FROM pg_type WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace`,
    );
    const enums = new Set(result.rows.map((r) => r.typname));
    for (const expected of [
      'transport_order_state',
      'manifest_state',
      'upload_session_state',
      'manifest_rejection_reason',
      'erp_sync_direction',
      'erp_sync_status',
    ]) {
      expect(enums.has(expected)).toBe(true);
    }
  });

  it('drizzle journal records the migration as applied', async () => {
    const result = await db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM "drizzle"."__drizzle_migrations"`,
    );
    expect(Number(result.rows[0]?.count ?? 0)).toBeGreaterThan(0);
  });

  // REGRESSION GUARD (T33 enum-drift). The pg enum manifest_extraction_reason
  // must contain EXACTLY the @fleet/sync-protocol EXTRACTION_FAILURE_REASONS SSOT.
  // This is the cheap lower-layer guard for the class of bug that shipped in T33:
  // the Zod SSOT + pgEnum DECLARATION were widened but no ALTER-TYPE migration was
  // written, so migration-based DBs (this fresh-migrated DB, CI, Railway) kept the
  // old value set while fresh-from-schema dev DBs masked it -- surfacing only as an
  // opaque 500 at the e2e/deploy seam. Asserting the migrated enum labels EQUAL the
  // contract makes the NEXT enum widening fail HERE (unit/integration) instead. Uses
  // the raw pool with a parameterized catalog query (pg_enum joined to pg_type).
  it('manifest_extraction_reason enum equals the EXTRACTION_FAILURE_REASONS SSOT', async () => {
    if (pool === undefined) throw new Error('pool not initialised');
    const res = await pool.query<{ enumlabel: string }>(
      'SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = $1 ORDER BY e.enumsortorder',
      ['manifest_extraction_reason'],
    );
    const dbLabels = res.rows.map((r) => r.enumlabel).sort();
    const ssot = [...EXTRACTION_FAILURE_REASONS].sort();
    expect(dbLabels).toEqual(ssot);
  });
});
