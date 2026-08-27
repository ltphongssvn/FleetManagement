// apps/api/src/scripts/audit-assignment-uniqueness.ts
// CLI entry for the READ-ONLY driver-vehicle assignment-pair uniqueness audit.
// Boots the minimal standalone ProjectionRebuildModule (config + database,
// no HTTP/OIDC/S3), resolves drizzle via DI, and runs the unit-tested
// auditAssignmentUniqueness classifier against live ACTIVE assignment rows
// for the pilot scope. NO mutation. Two modes:
//   default:      prints the violation report (duplicate driver/vehicle/pair groups).
//   --introspect: prints whether the two partial-unique indexes exist and are
//                 VALID in prod (pg_index.indisvalid) -- the drift check.
//
// Invoke via the Turbo task:
//   pnpm exec turbo run audit:assignment-uniqueness --filter=@fleet/api
//   pnpm exec turbo run audit:assignment-uniqueness --filter=@fleet/api -- --introspect
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { ProjectionRebuildModule } from '../projections/projection-rebuild.module.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { auditAssignmentUniqueness } from '../admin/assignment-uniqueness-audit.js';
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
               pg_get_expr(ix.indpred, ix.indrelid) AS predicate
        FROM pg_index ix
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_class t ON t.oid = ix.indrelid
        WHERE t.relname = 'driver_vehicle_assignment'
          AND i.relname LIKE 'dva_one_active_%'
        ORDER BY i.relname
      `);
      process.stdout.write(
        'ASSIGNMENT_INDEX_INTROSPECT ' + JSON.stringify(idx.rows, null, 2) + '\n',
      );
      return;
    }
    const rowsRes = await db.execute(sql`
      SELECT assignment_id AS "assignmentId",
             company_id AS "companyId",
             driver_id AS "driverId",
             vehicle_id AS "vehicleId"
      FROM driver_vehicle_assignment
      WHERE company_id = ${scope}
        AND revoked_at IS NULL
    `);
    const report = auditAssignmentUniqueness(rowsRes.rows);
    process.stdout.write(
      'ASSIGNMENT_UNIQUENESS_RESULT ' + JSON.stringify({ scope, ...report }, null, 2) + '\n',
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write('audit-assignment-uniqueness failed: ' + formatDbError(err) + '\n');
  process.exitCode = 1;
});
