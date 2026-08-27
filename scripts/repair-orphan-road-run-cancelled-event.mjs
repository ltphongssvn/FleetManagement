// scripts/repair-orphan-road-run-cancelled-event.mjs
// Compensating-event repair (event-pipeline rule): append the MISSING
// road_run.cancelled event for orphan 8ff951c9 through the SAME machinery
// the cancel service uses (allocateServerSeq + appendTriWrite in one tx).
// The running api ProjectionRunnerService consumes sync_change_feed and
// heals dispatch_board_projection itself. Idempotent: fixed actionId +
// idempotent=true, so re-runs report duplicate and write nothing.
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { appendTriWrite } from './dist/database/append-tri-write.js';
import { allocateServerSeq } from './dist/database/server-seq.repository.js';

const ROAD_RUN_ID = '8ff951c9-5e02-4e31-8f06-f7bbc991f730';
const ACTION_ID = '00000000-0000-0000-0000-00000000e9a1';
const ZERO = '00000000-0000-0000-0000-000000000000';
const op = {
  operatorId: '00000000-0000-0000-0000-0000000000aa',
  companyId: ZERO,
  businessUnitId: ZERO,
  depotId: ZERO,
  legalEntityId: ZERO,
};
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);
const result = await db.transaction(async (tx) => {
  const serverSeq = await allocateServerSeq(tx);
  return appendTriWrite(tx, {
    serverSeq,
    actionId: ACTION_ID,
    aggregateType: 'road_run',
    aggregateId: ROAD_RUN_ID,
    delta: { state: 'cancelled' },
    eventType: 'road_run.cancelled',
    auditPayload: {
      roadRunId: ROAD_RUN_ID,
      repair: 'orphan-road-run-compensating-event',
      reason: 'teardown_orphaned_run_write_model_cancelled_2026-07-06',
    },
    operatorId: op.operatorId,
    queueName: 'projections',
    outboxPayload: {
      aggregateType: 'road_run',
      eventType: 'road_run.cancelled',
      roadRunId: ROAD_RUN_ID,
      repair: 'orphan-road-run-compensating-event',
    },
    op,
    idempotent: true,
  });
});
console.log('duplicate:', result.duplicate);
await pool.end();
