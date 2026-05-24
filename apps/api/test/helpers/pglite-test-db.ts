// apps/api/test/helpers/pglite-test-db.ts
// In-memory Postgres via PGLite. ~10ms cold start vs ~3-10s for Testcontainers.
// Trade-off: no PostGIS, no real advisory locks. Use Testcontainers for those.
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../../src/database/schema/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(here, '../../src/database/migrations');

export interface PgliteTestDb {
  readonly client: PGlite;
  readonly db: PgliteDatabase<typeof schema>;
}

export async function startPgliteTestDb(): Promise<PgliteTestDb> {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder });
  return { client, db };
}

export async function stopPgliteTestDb(testDb: PgliteTestDb): Promise<void> {
  await testDb.client.close();
}
