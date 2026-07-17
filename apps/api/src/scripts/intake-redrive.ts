// apps/api/src/scripts/intake-redrive.ts
// CLI for the intake backlog redrive (Jun-24 incident repair). Emits
// compensating manifest_intake.requested outbox rows for every manifest
// stranded in verifying, so the pipeline (relay -> BullMQ -> worker ->
// finalizeIntake) drives them to committed/rejected itself. Event-sourcing
// repair protocol: state is never hand-patched. Duplicate delivery is inert
// (finalizeIntake FSM guards reject a second transition).
//
// DRY-RUN by default: prints the candidate table and exits. Mutation
// requires BOTH --execute AND FLEET_ALLOW_INTAKE_REDRIVE=true (the
// wipe-business-data speed-bump pattern).
//
// Invoke via the Turbo task:
//   pnpm exec turbo run intake:redrive --filter=@fleet/api                 (dry-run)
//   FLEET_ALLOW_INTAKE_REDRIVE=true \
//   pnpm exec turbo run intake:redrive --filter=@fleet/api -- --execute    (mutate)
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '../database/schema/index.js';
import { manifest, uploadSession } from '../database/schema/manifest.js';
import { outbox } from '../database/schema/append-paths.js';
import { allocateServerSeq } from '../database/server-seq.repository.js';
import { buildIntakeRedriveOutboxValues } from '../manifest/intake-redrive.builder.js';
import { validateRebuildEnv } from '../config/env.config.js';

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  // Factor XII: admin scripts read config through the same validated loader as
  // the app. validateRebuildEnv derives from the EnvSchema SSOT via .pick, so a
  // missing/malformed DATABASE_URL fails fast here with the boundary error
  // rather than a bespoke undefined check.
  const url = validateRebuildEnv(process.env).DATABASE_URL;
  if (execute && process.env['FLEET_ALLOW_INTAKE_REDRIVE'] !== 'true') {
    console.error('REFUSED: --execute requires FLEET_ALLOW_INTAKE_REDRIVE=true');
    process.exit(2);
  }
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  console.log('intake-redrive (' + (execute ? 'EXECUTE' : 'dry-run') + ') against ' + url.replace(/:[^:@/]+@/, ':***@'));
  try {
    const candidates = await db
      .select({
        companyId: manifest.companyId,
        businessUnitId: manifest.businessUnitId,
        depotId: manifest.depotId,
        legalEntityId: manifest.legalEntityId,
        manifestId: manifest.manifestId,
        manifestCreatedAt: manifest.createdAt,
        uploadSessionId: uploadSession.uploadSessionId,
        s3Key: uploadSession.s3Key,
        s3Bucket: uploadSession.s3Bucket,
        contentType: uploadSession.contentType,
        expectedSizeBytes: uploadSession.expectedSizeBytes,
        actualSizeBytes: uploadSession.actualSizeBytes,
        contentHash: uploadSession.contentHash,
      })
      .from(manifest)
      .innerJoin(uploadSession, eq(uploadSession.manifestId, manifest.manifestId))
      .where(and(eq(manifest.state, 'verifying'), isNull(manifest.committedAt)))
      .orderBy(manifest.createdAt);
    console.log('candidates: ' + String(candidates.length));
    for (const c of candidates) {
      console.log(
        '  ' + c.manifestId + '  ' + c.manifestCreatedAt.toISOString() + '  ' + c.s3Key.slice(0, 60),
      );
    }
    if (!execute) {
      console.log('dry-run complete; re-run with --execute (+ FLEET_ALLOW_INTAKE_REDRIVE=true) to emit events');
      return;
    }
    let emitted = 0;
    let skipped = 0;
    await db.transaction(async (tx) => {
      for (const c of candidates) {
        try {
          const seq = await allocateServerSeq(tx);
          const values = buildIntakeRedriveOutboxValues(c, seq);
          await tx.insert(outbox).values(values);
          emitted += 1;
        } catch (err: unknown) {
          skipped += 1;
          console.error('  SKIP ' + c.manifestId + ': ' + (err instanceof Error ? err.message : String(err)));
        }
      }
    });
    console.log('INTAKE_REDRIVE_RESULT ' + JSON.stringify({ candidates: candidates.length, emitted, skipped }));
  } finally {
    await pool.end();
  }
}
main().catch((err: unknown) => {
  console.error('intake-redrive failed: ' + (err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
