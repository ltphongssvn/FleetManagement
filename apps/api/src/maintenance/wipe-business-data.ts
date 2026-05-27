// apps/api/src/maintenance/wipe-business-data.ts
//
// Maintenance utility: empties all business tables while preserving schema,
// migrations, and constraints. Use case: reset dev/staging environment to
// a clean slate so the first new transport_order is XT.0001 again.
//
// 2026 industry pattern (single-statement TRUNCATE):
//   - One atomic AccessExclusiveLock acquisition over all named relations
//     -> no inter-table deadlock window across concurrent callers.
//   - RESTART IDENTITY resets every owned sequence (order_sequence's
//     next_value, any serial/identity column) so dispatchers see XT.0001
//     on the next create.
//   - CASCADE follows FK refs (e.g. stop -> transport_order) so the
//     caller does not need to know the dependency graph.
//   - Excludes the drizzle migration bookkeeping table, which lives in
//     its own 'drizzle' schema (not 'public') and survives untouched, so
//     the database remains correctly migrated after the wipe.
//
// SAFETY:
//   - Operates only on tables in the public schema.
//   - Production guard at the CLI entrypoint (scripts/wipe-business-data.ts)
//     refuses to run unless FLEET_ALLOW_DESTRUCTIVE_WIPE=true.
//   - This module itself is environment-agnostic so it can be unit-tested
//     against pglite/Testcontainers; the guard is at the caller boundary.
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
// Accept either node-postgres or pglite drizzle instances. The runtime
// requirement is just .execute(sql).
type AnyDb = NodePgDatabase | PgliteDatabase;
export async function wipeBusinessData(db: AnyDb): Promise<void> {
  // Enumerate all public-schema tables EXCEPT migration bookkeeping. Drizzle
  // stores its history in the 'drizzle' schema so it is implicitly excluded
  // by the schemaname filter; the additional name filter is defensive.
  const r = await db.execute<{ tablename: string }>(sql.raw(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'"
  ));
  const tables = r.rows.map((row) => row.tablename);
  if (tables.length === 0) return;
  // Quote names defensively in case any contain reserved words / mixed case.
  const list = tables.map((t) => '"' + t + '"').join(', ');
  await db.execute(sql.raw('TRUNCATE TABLE ' + list + ' RESTART IDENTITY CASCADE'));
}
