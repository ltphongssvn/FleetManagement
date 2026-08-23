// apps/api/src/database/migration-connection.ts
// Layer-1 connection selection: migrations need an elevated DDL-capable role while
// the runtime app connects as a restricted least-privilege role (no DDL, no DELETE).
//
// When MIGRATION_DATABASE_URL is provided it is used for the boot-time migrate + seed
// steps (which require CREATE/ALTER); otherwise we fall back to DATABASE_URL so
// existing single-credential environments keep working unchanged. The runtime pool
// (database.module.ts) always uses DATABASE_URL, which in a Layer-1 deployment is the
// restricted role. Pure + env-injected so it is unit-testable without a real database.
export function selectMigrationConnectionString(env: Record<string, string | undefined>): string {
  const migrationUrl = env['MIGRATION_DATABASE_URL'];
  if (migrationUrl !== undefined && migrationUrl.length > 0) return migrationUrl;
  const databaseUrl = env['DATABASE_URL'];
  if (databaseUrl !== undefined && databaseUrl.length > 0) return databaseUrl;
  throw new Error('No migration connection string: set MIGRATION_DATABASE_URL or DATABASE_URL');
}
