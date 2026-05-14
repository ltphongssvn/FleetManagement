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
  // Only end THIS file's pool. The container is started with .withReuse() and is
  // shared across every integration-test file in the run; calling container.stop()
  // here terminates Postgres while other files' pools still have connections in
  // flight, surfacing as a FATAL 57P01 (ProcessInterrupts) unhandled error that
  // fails the whole vitest run. Testcontainers' reuse mechanism owns the shared
  // container lifecycle -- per-file teardown must not stop it.
  await testDb.pool.end();
}
