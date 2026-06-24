// apps/api/scripts/wipe-business-data.ts
//
// CLI entrypoint for the wipeBusinessData maintenance utility.
//
// Production-safety guard: refuses to run unless the operator explicitly
// sets FLEET_ALLOW_DESTRUCTIVE_WIPE=true. This is a deliberate "are you
// sure" speed bump that prevents the script from being launched by a
// misconfigured cron, CI job, or muscle-memory shell history recall.
//
// Usage:
//   FLEET_ALLOW_DESTRUCTIVE_WIPE=true DATABASE_URL=postgres://... \\
//     pnpm exec tsx apps/api/scripts/wipe-business-data.ts
//
// Or via docker compose for the pilot stack:
//   docker exec fleet-pilot-api-1 sh -c 'FLEET_ALLOW_DESTRUCTIVE_WIPE=true \\
//     node --import tsx dist/scripts/wipe-business-data.js'
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { wipeBusinessData } from '../src/maintenance/wipe-business-data.js';
import {
  resolveGuardEnvironment,
  type BreakGlassAuthorization,
} from '../src/maintenance/destructive-operation-guard.js';
async function main(): Promise<void> {
  if (process.env['FLEET_ALLOW_DESTRUCTIVE_WIPE'] !== 'true') {
    console.error('REFUSED: set FLEET_ALLOW_DESTRUCTIVE_WIPE=true to proceed');
    process.exit(2);
  }
  const url = process.env['DATABASE_URL'];
  if (url === undefined || url.length === 0) {
    console.error('REFUSED: DATABASE_URL must be set');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  console.log('wipe-business-data: starting against ' + url.replace(/:[^:@/]+@/, ':***@'));
  // The operator has set FLEET_ALLOW_DESTRUCTIVE_WIPE=true (the explicit human
  // confirmation above). Translate that into the typed break-glass the policy-as-code
  // guard requires, naming the environment actually resolved from process signals, so
  // a production run is authorized intentionally rather than bypassed. (Layered: the
  // env-flag is the human speed bump; the guard is the policy-as-code authorization.)
  const resolvedEnv = resolveGuardEnvironment();
  const authorization: BreakGlassAuthorization = {
    confirmedEnvironment: resolvedEnv,
    reason: 'operator-confirmed CLI wipe via FLEET_ALLOW_DESTRUCTIVE_WIPE',
  };
  await wipeBusinessData(db, { environment: resolvedEnv, authorization });
  console.log('wipe-business-data: OK');
  await pool.end();
}
main().catch((err: unknown) => {
  console.error('wipe-business-data: FAILED', err);
  process.exit(1);
});
