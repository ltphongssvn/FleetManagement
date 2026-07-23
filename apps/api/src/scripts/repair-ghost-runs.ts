// apps/api/src/scripts/repair-ghost-runs.ts
// CLI entry for the event-sourced ghost-run repair (T9 arc). Boots the
// same minimal standalone Nest context the projection rebuild uses
// (ProjectionRebuildModule: config + database only relevant wiring, no
// HTTP, no OIDC/S3), resolves the drizzle db via DI, and runs
// repairGhostRuns. DRY-RUN BY DEFAULT: prints the ghost set and mutates
// nothing unless --execute is passed (dry-run-before-mutate rule).
// The running api projection runner consumes the appended
// road_run.cancelled events and heals dispatch_board itself.
//
// Invoke via the Turbo task:
//   pnpm exec turbo run repair:ghost-runs --filter=@fleet/api            (dry-run)
//   pnpm exec turbo run repair:ghost-runs --filter=@fleet/api -- --execute
// Scope defaults to FLEET_PILOT_SCOPE when --scope is omitted.
import { NestFactory } from '@nestjs/core';
import { ProjectionRebuildModule } from '../projections/projection-rebuild.module.js';
import { DRIZZLE_DB } from '../database/database.tokens.js';
import type { FleetDb } from '../database/database.module.js';
import { repairGhostRuns } from '../maintenance/repair-ghost-runs.js';
import { resolveCliScope } from './resolve-cli-scope.js';
import { formatDbError } from './format-db-error.js';
// Fixed repair operator (same convention as the orphan-8ff951c9 repair
// script): a recognizable synthetic operator id in the audit trail.
const REPAIR_OPERATOR_ID = '00000000-0000-0000-0000-0000000000aa';
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const scope = resolveCliScope(argv, process.env);
  const execute = argv.includes('--execute');
  const app = await NestFactory.createApplicationContext(ProjectionRebuildModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const db = app.get<FleetDb>(DRIZZLE_DB);
    const result = await repairGhostRuns(db, {
      operatorId: REPAIR_OPERATOR_ID,
      companyId: scope, businessUnitId: scope, depotId: scope, legalEntityId: scope,
    }, { execute });
    process.stdout.write('REPAIR_GHOST_RUNS_RESULT ' + JSON.stringify(result) + '\n');
  } finally {
    await app.close();
  }
}
main().catch((err: unknown) => {
  process.stderr.write('repair-ghost-runs failed: ' + formatDbError(err) + '\n');
  process.exitCode = 1;
});
