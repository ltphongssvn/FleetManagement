// apps/api/test/helpers/pglite-test-db.ts
// In-memory Postgres via PGLite. ~10ms cold start vs ~3-10s for Testcontainers.
// Trade-off: no PostGIS, no real advisory locks. Use Testcontainers for those.
//
// Contrib extensions are NOT bundled by default in PGLite: each must be
// registered on the client at construction (extensions: { ... }) for its
// CREATE EXTENSION to succeed during migrate(). unaccent is registered here so
// the 20260712100000_unaccent_extension migration (diacritic-insensitive search
// over Vietnamese text) applies in-memory exactly as it does on real Postgres,
// preserving test/prod parity. Add further contrib modules the same way.
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
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
  const client = new PGlite({ extensions: { unaccent } });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  await migrate(db, { migrationsFolder });
  return { client, db };
}
export async function stopPgliteTestDb(testDb: PgliteTestDb): Promise<void> {
  await testDb.client.close();
}
