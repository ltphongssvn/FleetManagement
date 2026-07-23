// apps/api/src/scripts/audit-device-registry.ts
// CLI entry for the READ-ONLY device_registry fabrication audit (P2 of the
// remove-manual-device-udid arc). Boots the same minimal standalone Nest
// context the ghost-run repair uses (ProjectionRebuildModule: config +
// database only, no HTTP/OIDC/S3), resolves drizzle via DI, and runs the
// unit-tested auditDeviceRegistry classifier against live rows for the pilot
// scope. NO mutation, no --execute: this only quantifies the fabrication
// baseline (duplicate udids, ios monoculture, 0.0.0 placeholders) plus the
// active device_session blast-radius before the removal + column-drop.
//
// Invoke via the Turbo task:
//   pnpm exec turbo run audit:device-registry --filter=@fleet/api
// Scope defaults to FLEET_PILOT_SCOPE when --scope is omitted.
import { NestFactory } from '@nestjs/core';
import { sql, and, count, inArray, isNull } from 'drizzle-orm';
import { deviceSession } from '../database/schema/device.js';
import { ProjectionRebuildModule } from '../projections/projection-rebuild.module.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { auditDeviceRegistry } from '../admin/device-registry-audit.js';
import { resolveCliScope } from './resolve-cli-scope.js';
import { formatDbError } from './format-db-error.js';



async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const scope = resolveCliScope(argv, process.env);
  const introspect = argv.includes('--introspect');
  const app = await NestFactory.createApplicationContext(ProjectionRebuildModule, {

    logger: ['error', 'warn', 'log'],
  });
  try {
    const db = app.get<FleetDb>(DRIZZLE_DB);
    if (introspect) {
      const cols = await db.execute(sql`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'device_registry'
        ORDER BY ordinal_position
      `);
      const colRows = cols.rows;
      process.stdout.write('DEVICE_REGISTRY_COLUMNS ' + JSON.stringify(colRows, null, 2) + '\n');
      return;
    }

    const rowsRes = await db.execute(sql`
      SELECT device_id AS "deviceId",
             operator_id AS "operatorId",
             platform,
             app_version AS "appVersion",
             udid
      FROM device_registry
      WHERE company_id = ${scope}
    `);
    const rows = rowsRes.rows;
    const report = auditDeviceRegistry(rows);

    const dupDeviceIds = report.duplicateUdids.flatMap((d) => d.deviceIds);
    let activeSessionsOnDuplicateDevices = 0;
    if (dupDeviceIds.length > 0) {
      const sess = await db
        .select({ n: count() })
        .from(deviceSession)
        .where(and(
          inArray(deviceSession.deviceId, dupDeviceIds),
          isNull(deviceSession.revokedAt),
        ));
      activeSessionsOnDuplicateDevices = sess[0]?.n ?? 0;
    }

    const out = {
      scope,
      totalDevices: report.totalDevices,
      platformCounts: report.platformCounts,
      isPlatformMonoculture: report.isPlatformMonoculture,
      duplicateUdidGroups: report.duplicateUdids.length,
      duplicateUdids: report.duplicateUdids,
      placeholderVersionCount: report.placeholderVersionDeviceIds.length,
      activeSessionsOnDuplicateDevices,
    };
    process.stdout.write('AUDIT_DEVICE_REGISTRY_RESULT ' + JSON.stringify(out, null, 2) + '\n');
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write('audit-device-registry failed: ' + formatDbError(err) + '\n');
  process.exitCode = 1;
});
