// apps/api/src/scripts/audit-driver-roster.ts
// CLI entry for the READ-ONLY driver roster audit. Boots the minimal
// standalone ProjectionRebuildModule (config + database, no HTTP/OIDC/S3),
// resolves drizzle via DI, and runs the unit-tested auditDriverRoster
// classifier against live driver rows for the pilot scope. NO mutation.
//
// Two modes:
//   default:      prints the roster report -- active/inactive counts, exact and
//                 folded ACTIVE name collisions, soft-deleted rows still
//                 holding a live assignment, and phones a soft-deleted row has
//                 reserved against re-registration.
//   --introspect: prints whether driver_company_active_name_ci_uq and
//                 driver_company_phone_uq exist and are VALID in prod
//                 (pg_index.indisvalid) -- the drift check. An exact ACTIVE
//                 name collision in the default report is only meaningful
//                 alongside this: it says whether Postgres was ASKED to block
//                 the duplicate and failed to, or was never asked at all.
//
// Rows are shaped in SQL to the trust-boundary contract the classifier parses:
// assignment and device counts are correlated subqueries so a driver with no
// children still yields 0 rather than vanishing from the roster (an INNER JOIN
// here would silently hide exactly the unconfigured rows under investigation).
//
// Invoke via the Turbo task:
//   pnpm exec turbo run audit:driver-roster --filter=@fleet/api
//   pnpm exec turbo run audit:driver-roster --filter=@fleet/api -- --introspect
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { ProjectionRebuildModule } from '../projections/projection-rebuild.module.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { auditDriverRoster } from '../admin/driver-roster-audit.js';
import { resolveCliScope } from './resolve-cli-scope.js';
import { formatDbError } from './format-db-error.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const introspect = argv.includes('--introspect');
  const scope = resolveCliScope(argv, process.env);
  const app = await NestFactory.createApplicationContext(ProjectionRebuildModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const db = app.get<FleetDb>(DRIZZLE_DB);
    if (introspect) {
      const idx = await db.execute(sql`
        SELECT i.relname AS index_name, ix.indisvalid AS is_valid, ix.indisunique AS is_unique,
               pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
               pg_get_indexdef(ix.indexrelid) AS definition
        FROM pg_index ix
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_class t ON t.oid = ix.indrelid
        WHERE t.relname = 'driver'
        ORDER BY i.relname
      `);
      process.stdout.write('DRIVER_INDEX_INTROSPECT ' + JSON.stringify(idx.rows, null, 2) + '\n');
      return;
    }
    const rowsRes = await db.execute(sql`
      SELECT d.driver_id AS "driverId",
             d.company_id AS "companyId",
             d.full_name AS "fullName",
             d.phone AS "phone",
             d.active AS "active",
             d.operator_id AS "operatorId",
             (SELECT COUNT(*)::int FROM driver_vehicle_assignment a
               WHERE a.driver_id = d.driver_id
                 AND a.company_id = d.company_id
                 AND a.revoked_at IS NULL) AS "activeAssignmentCount",
             (SELECT COUNT(*)::int FROM device_registry dr
               WHERE d.operator_id IS NOT NULL
                 AND dr.operator_id = d.operator_id) AS "deviceCount"
      FROM driver d
      WHERE d.company_id = ${scope}
      ORDER BY d.full_name, d.created_at
    `);
    const report = auditDriverRoster(rowsRes.rows);
    process.stdout.write('DRIVER_ROSTER_RESULT ' + JSON.stringify({ scope, ...report }, null, 2) + '\n');
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write('audit-driver-roster failed: ' + formatDbError(err) + '\n');
  process.exitCode = 1;
});
