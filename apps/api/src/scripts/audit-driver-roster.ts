// apps/api/src/scripts/audit-driver-roster.ts
// CLI entry for the READ-ONLY driver roster audit. Boots the minimal
// standalone ProjectionRebuildModule (config + database, no HTTP/OIDC/S3),
// resolves drizzle via DI, and runs the unit-tested auditDriverRoster
// classifier against live driver rows for the pilot scope. NO mutation.
//
// Three modes:
//   default:      prints the roster report -- active/inactive counts, exact and
//                 folded ACTIVE name collisions, soft-deleted rows still
//                 holding a live assignment, and phones a soft-deleted row has
//                 reserved against re-registration.
//   --introspect: prints whether the driver indexes exist and are VALID in prod
//                 (pg_index.indisvalid) -- the drift check. A folded collision
//                 is only interpretable alongside this: it says whether
//                 Postgres was ASKED to block the duplicate and failed, or was
//                 never asked at all.
//   --forensics:  for every driver in a reported collision group, attributes
//                 the byte difference to a CAUSE via nameForensics -- NFD
//                 composition, collapsible whitespace, or an invisible code
//                 point -- and prints the escaped code points so the offending
//                 characters are visible in a terminal. The default report
//                 detects a collision; only this explains one, and the
//                 explanation selects the fix (DB index expression vs a writer
//                 bypassing normalizeDisplayName).
//
// Rows are shaped in SQL to the trust-boundary contract the classifier parses:
// assignment and device counts are correlated subqueries so a driver with no
// children still yields 0 rather than vanishing from the roster (an INNER JOIN
// here would silently hide exactly the unconfigured rows under investigation).
//
// PARSE, NEVER CAST. db.execute returns rows typed by an index signature, and
// the first cut of this file reached for `as Record<string, unknown>` plus
// String() coercions to read them -- a cast at a trust boundary, which the
// two-axis rule forbids, and which the compiler rejected anyway under
// noPropertyAccessFromIndexSignature (TS4111). Parsing the rows through
// DriverRosterAuditRowSchema -- the SSOT the classifier already owns -- yields
// properly typed rows, so dot access is legal, no coercion is needed, and a
// shape change in SQL fails loudly here instead of silently producing
// undefined. The classifier re-parses its own input by design: it is the
// boundary for every caller, and parse is idempotent on already-valid data.
//
// Invoke via the Turbo task:
//   pnpm exec turbo run audit:driver-roster --filter=@fleet/api
//   pnpm exec turbo run audit:driver-roster --filter=@fleet/api -- --introspect
//   pnpm exec turbo run audit:driver-roster --filter=@fleet/api -- --forensics
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { ProjectionRebuildModule } from '../projections/projection-rebuild.module.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import {
  auditDriverRoster,
  DriverRosterAuditRowSchema,
  type DriverRosterAuditRow,
} from '../admin/driver-roster-audit.js';
import { nameForensics } from '../admin/name-forensics.js';
import { resolveCliScope } from './resolve-cli-scope.js';
import { formatDbError } from './format-db-error.js';

// Render a name as explicit code points so an invisible or a combining mark
// is VISIBLE in terminal output. Printing the raw string is useless here --
// the whole problem is that the two spellings look identical. Iterates with
// for...of (code points) rather than spread or .split(''), which the lint
// rule forbids; Intl.Segmenter is deliberately NOT used, since grapheme
// clustering would re-merge a combining mark into its base letter and hide
// the exact character being hunted.
function escapeCodePoints(name: string): string {
  const parts: string[] = [];
  for (const ch of name) {
    const cp = ch.codePointAt(0) ?? 0;
    const printable = cp > 0x20 && cp < 0x7f;
    parts.push(printable ? ch : 'U+' + cp.toString(16).toUpperCase().padStart(4, '0'));
  }
  return parts.join(' ');
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const introspect = argv.includes('--introspect');
  const forensics = argv.includes('--forensics');
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
    const rows: DriverRosterAuditRow[] = rowsRes.rows.map((r) =>
      DriverRosterAuditRowSchema.parse(r),
    );
    const report = auditDriverRoster(rows);
    if (!forensics) {
      process.stdout.write(
        'DRIVER_ROSTER_RESULT ' + JSON.stringify({ scope, ...report }, null, 2) + '\n',
      );
      return;
    }
    // Forensics mode: explain every row the classifier reported as colliding.
    // The classifier is not re-run; its groups ARE the question being answered.
    const colliding = new Set(
      [...report.exactNameCollisionGroups, ...report.foldedNameCollisionGroups].flatMap(
        (g) => g.driverIds,
      ),
    );
    const detail = rows
      .filter((r) => colliding.has(r.driverId))
      .map((r) => ({
        driverId: r.driverId,
        active: r.active,
        phone: r.phone,
        activeAssignmentCount: r.activeAssignmentCount,
        deviceCount: r.deviceCount,
        name: r.fullName,
        codePoints: escapeCodePoints(r.fullName),
        forensics: nameForensics(r.fullName),
      }));
    process.stdout.write(
      'DRIVER_NAME_FORENSICS ' + JSON.stringify({ scope, detail }, null, 2) + '\n',
    );
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write('audit-driver-roster failed: ' + formatDbError(err) + '\n');
  process.exitCode = 1;
});
