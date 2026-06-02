// apps/api/test/helpers/migrate-test-db.ts
// Shared helper for integration tests: spin up Postgres + apply real drizzle
// migrations. Eliminates inline CREATE TABLE drift.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../../src/database/schema/index.js';
import { sql } from 'drizzle-orm';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../src/database/migrations');

const POSTGRES_IMAGE = 'postgres:16.4-alpine3.20';

export interface MigratedTestDb {
  readonly container: StartedPostgreSqlContainer;
  readonly pool: Pool;
  readonly db: NodePgDatabase<typeof schema>;
}

export async function startMigratedTestDb(databaseName = 'fleet_test'): Promise<MigratedTestDb> {
  const container = await new PostgreSqlContainer(POSTGRES_IMAGE)
    .withDatabase(databaseName)
    .withReuse()
    .start();
  const pool = new Pool({ connectionString: container.getConnectionUri() });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder });
  return { container, pool, db };
}

export async function stopMigratedTestDb(testDb: MigratedTestDb): Promise<void> {
  // Null-safe: when a beforeAll hook times out under heavy CI load, testDb is
  // never assigned, so afterAll calls this with undefined. Guard so one slow
  // container start surfaces ONE clear timeout, not a cascading secondary
  // TypeError that fails unrelated test files.
  // testDb is typed non-nullable, but a timed-out beforeAll never assigns it,
  // so at runtime it can be undefined. Cast to a nullable view to guard honestly.
  const maybe = testDb as { pool?: Pool } | undefined;
  if (maybe?.pool === undefined) return;
  // Only end THIS file's pool. The container is started with .withReuse() and is
  // shared across every integration-test file in the run; calling container.stop()
  // here terminates Postgres while other files' pools still have connections in
  // flight, surfacing as a FATAL 57P01 (ProcessInterrupts) unhandled error that
  // fails the whole vitest run. Testcontainers' reuse mechanism owns the shared
  // container lifecycle -- per-file teardown must not stop it.
  await testDb.pool.end();
}


// Truncate every table in the public schema in a SINGLE atomic TRUNCATE
// statement. Postgres acquires the AccessExclusiveLock on all named relations
// within one statement, so concurrent integration-test files can never lock
// tables in conflicting orders -- this eliminates the intermittent 40P01
// deadlocks seen when each file ran a per-table TRUNCATE loop against the
// shared, reused container. __drizzle_migrations is unaffected: it lives in
// the dedicated `drizzle` schema, not `public`, so the migration bookkeeping
// survives. RESTART IDENTITY resets sequences for deterministic test runs.
export async function truncateAllTables(
  db: NodePgDatabase<typeof schema>,
): Promise<void> {
  const result = await db.execute<{ tablename: string }>(sql.raw(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  ));
  const tables = result.rows
    .map((r) => r.tablename)
    .filter((t) => t !== '__drizzle_migrations');
  if (tables.length === 0) return;
  const list = tables.map((t) => '"' + t + '"').join(', ');
  await db.execute(sql.raw('TRUNCATE TABLE ' + list + ' RESTART IDENTITY CASCADE'));
}
