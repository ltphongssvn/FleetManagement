// apps/api/src/scripts/repair-complete-delivered-runs.ts
// CLI entry for the event-sourced completion reconciler (T16 arc). Boots
// the same minimal standalone Nest context repair-ghost-runs uses
// (ProjectionRebuildModule: config + database, no HTTP/OIDC/S3), resolves
// the drizzle db via DI, and runs repairCompleteDeliveredRuns. DRY-RUN BY
// DEFAULT: prints the delivered-but-incomplete set and mutates nothing
// unless --execute is passed (dry-run-before-mutate rule). The running api
// projection runner consumes the appended road_run.completed events and
// heals dispatch_board itself.
//
// Invoke via the Turbo task:
//   pnpm exec turbo run repair:complete-delivered-runs --filter=@fleet/api            (dry-run)
//   pnpm exec turbo run repair:complete-delivered-runs --filter=@fleet/api -- --execute
// Scope defaults to FLEET_PILOT_SCOPE when --scope is omitted.
import { NestFactory } from "@nestjs/core";
import { ProjectionRebuildModule } from "../projections/projection-rebuild.module.js";
import { DRIZZLE_DB } from "../database/database.tokens.js";
import type { FleetDb } from "../database/database.module.js";
import { repairCompleteDeliveredRuns } from "../maintenance/repair-complete-delivered-runs.js";
import { resolveCliScope } from "./resolve-cli-scope.js";

// Fixed repair operator (same convention as repair-ghost-runs): a
// recognizable synthetic operator id in the audit trail.
const REPAIR_OPERATOR_ID = "00000000-0000-0000-0000-0000000000aa";


async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const scope = resolveCliScope(argv, process.env);
  const execute = argv.includes("--execute");
  const app = await NestFactory.createApplicationContext(ProjectionRebuildModule, {
    logger: ["error", "warn", "log"],
  });
  try {
    const db = app.get<FleetDb>(DRIZZLE_DB);
    const result = await repairCompleteDeliveredRuns(db, {
      operatorId: REPAIR_OPERATOR_ID,
      companyId: scope, businessUnitId: scope, depotId: scope, legalEntityId: scope,
    }, { execute });
    process.stdout.write("REPAIR_COMPLETE_DELIVERED_RUNS_RESULT " + JSON.stringify(result) + "\n");
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write("repair-complete-delivered-runs failed: " + (err instanceof Error ? err.message : String(err)) + "\n");
  process.exitCode = 1;
});
