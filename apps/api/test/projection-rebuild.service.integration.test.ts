// apps/api/test/projection-rebuild.service.integration.test.ts
// RED (follow-up #5, 2026-07-07): the sanctioned "rebuild second" path
// (event-repair first, rebuild second, never manual patch). Rebuild resets a
// scope's dispatch_board_projection to its event-derived truth by replaying
// sync_change_feed from server_seq 0 through the SAME projection runner.
//
// 2026 practice (reset-checkpoint-then-replay + @ResetHandler clear-before-
// replay to avoid additive corruption): rebuild must (1) hide the scope's
// current projection rows so a row NOT re-emitted by replay does not linger,
// (2) reset the watermark to 0, (3) drain the full feed idempotently, and
// (4) stamp projection_status.last_rebuilt_at. App role holds no DELETE, so
// "clear" is the same soft-delete (deleted_at) the runner already uses; the
// upsert path re-activates re-emitted rows (deleted_at -> null).
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { ProjectionRebuildService } from '../src/projections/projection-rebuild.service.js';
import { ProjectionRunnerService } from '../src/projections/projection-runner.service.js';
import {
  startMigratedTestDb,
  stopMigratedTestDb,
  type MigratedTestDb,
} from './helpers/migrate-test-db.js';
import { rowsOf } from './helpers/integration-rows.js';

let testDb: MigratedTestDb;
const COMPANY = '00000000-0000-0000-0000-000000000003';
const BU = '00000000-0000-0000-0000-000000000004';
const DEPOT = '00000000-0000-0000-0000-000000000005';
const LE = '00000000-0000-0000-0000-000000000006';
const RR1 = '00000000-0000-0000-0000-000000000010';
const RR2 = '00000000-0000-0000-0000-000000000011';
const A1 = '00000000-0000-0000-0000-0000000000a1';
const A2 = '00000000-0000-0000-0000-0000000000a2';

async function feed(
  seq: number,
  rr: string,
  action: string,
  state: string,
  stops: number,
): Promise<void> {
  await testDb.db.execute(sql`
    INSERT INTO sync_change_feed (feed_id, company_id, business_unit_id, depot_id, legal_entity_id, server_seq, action_id, aggregate_type, aggregate_id, delta, created_at)
    VALUES (gen_random_uuid(), ${COMPANY}, ${BU}, ${DEPOT}, ${LE}, ${seq}, ${action}, 'road_run', ${rr},
            jsonb_build_object('roadRunId', ${rr}::text, 'state', ${state}::text, 'serverSeq', ${seq}::int, 'assignedOperatorId', null, 'assignedAssetId', null, 'plannedStartAt', '2026-04-29T08:00:00.000Z', 'stopCount', ${stops}::int, 'transportOrderRefs', jsonb_build_array('TO-1')),
            now())`);
}

describe('@fleet/api - ProjectionRebuildService (integration)', () => {
  beforeAll(async () => {
    testDb = await startMigratedTestDb('fleet_proj_rebuild_int');
  });
  afterAll(async () => {
    await stopMigratedTestDb(testDb);
  });
  beforeEach(async () => {
    await testDb.db.execute(
      sql`TRUNCATE TABLE sync_change_feed, dispatch_board_projection, projection_status CASCADE`,
    );
  });

  it('rebuilds a corrupted projection back to event-derived truth', async () => {
    await feed(1, RR1, A1, 'started', 2);
    const runner = new ProjectionRunnerService(testDb.db);
    await runner.drainOnce(COMPANY);
    // Corrupt the read model directly (simulating drift a manual patch caused).
    await testDb.db.execute(
      sql`UPDATE dispatch_board_projection SET state = 'planned', stop_count = 99 WHERE road_run_id = ${RR1}`,
    );
    const rebuild = new ProjectionRebuildService(testDb.db, runner);
    const res = await rebuild.rebuild(COMPANY);
    expect(res.scope).toBe(COMPANY);
    expect(res.rebuilt).toBe(true);
    const r = rowsOf<{ state: string; stop_count: number }>(
      (await testDb.db.execute(
        sql`SELECT state, stop_count FROM dispatch_board_projection WHERE road_run_id = ${RR1} AND deleted_at IS NULL`,
      )) as unknown as { rows: readonly { state: string; stop_count: number }[] },
    );
    expect(r[0]?.state).toBe('started');
    expect(Number(r[0]?.stop_count)).toBe(2);
  });

  it('resets the watermark to 0 then re-advances it to the feed head', async () => {
    await feed(7, RR1, A1, 'started', 1);
    const runner = new ProjectionRunnerService(testDb.db);
    const rebuild = new ProjectionRebuildService(testDb.db, runner);
    await rebuild.rebuild(COMPANY);
    const r = rowsOf<{ watermark: string }>(
      (await testDb.db.execute(
        sql`SELECT watermark FROM projection_status WHERE projection_name = 'dispatch_board' AND scope = ${COMPANY}`,
      )) as unknown as { rows: readonly { watermark: string }[] },
    );
    expect(String(r[0]?.watermark)).toBe('7');
  });

  it('stamps last_rebuilt_at (audit marker) without a manual read-model patch', async () => {
    await feed(1, RR1, A1, 'started', 1);
    const runner = new ProjectionRunnerService(testDb.db);
    const rebuild = new ProjectionRebuildService(testDb.db, runner);
    const before = new Date();
    await rebuild.rebuild(COMPANY);
    const r = rowsOf<{ last_rebuilt_at: string | null }>(
      (await testDb.db.execute(
        sql`SELECT last_rebuilt_at FROM projection_status WHERE projection_name = 'dispatch_board' AND scope = ${COMPANY}`,
      )) as unknown as { rows: readonly { last_rebuilt_at: string | null }[] },
    );
    expect(r[0]?.last_rebuilt_at).not.toBeNull();
    expect(new Date(String(r[0]?.last_rebuilt_at)).getTime()).toBeGreaterThanOrEqual(
      before.getTime() - 1000,
    );
  });

  it('drops a projection row that the replayed feed no longer produces (stale row hidden)', async () => {
    // Two runs materialized; then the feed only retains RR1 (RR2 event purged).
    await feed(1, RR1, A1, 'started', 1);
    await feed(2, RR2, A2, 'started', 1);
    const runner = new ProjectionRunnerService(testDb.db);
    await runner.drainOnce(COMPANY);
    await testDb.db.execute(sql`DELETE FROM sync_change_feed WHERE aggregate_id = ${RR2}`);
    const rebuild = new ProjectionRebuildService(testDb.db, runner);
    await rebuild.rebuild(COMPANY);
    const active = rowsOf<{ road_run_id: string }>(
      (await testDb.db.execute(
        sql`SELECT road_run_id FROM dispatch_board_projection WHERE deleted_at IS NULL ORDER BY road_run_id`,
      )) as unknown as { rows: readonly { road_run_id: string }[] },
    );
    expect(active.map((x) => x.road_run_id)).toEqual([RR1]);
  });

  it('is idempotent: a second rebuild leaves the same active rows', async () => {
    await feed(1, RR1, A1, 'started', 1);
    await feed(2, RR2, A2, 'planned', 3);
    const runner = new ProjectionRunnerService(testDb.db);
    const rebuild = new ProjectionRebuildService(testDb.db, runner);
    await rebuild.rebuild(COMPANY);
    await rebuild.rebuild(COMPANY);
    const active = rowsOf<{ road_run_id: string }>(
      (await testDb.db.execute(
        sql`SELECT road_run_id FROM dispatch_board_projection WHERE deleted_at IS NULL ORDER BY road_run_id`,
      )) as unknown as { rows: readonly { road_run_id: string }[] },
    );
    expect(active.map((x) => x.road_run_id)).toEqual([RR1, RR2]);
  });

  it('drains across multiple batches (more events than one POLL_BATCH_SIZE)', async () => {
    // 250 distinct road runs > POLL_BATCH_SIZE (200): rebuild must loop drainOnce.
    const hex = (n: number): string => n.toString(16).padStart(12, '0');
    for (let i = 0; i < 250; i += 1) {
      const rr = '00000000-0000-4000-8000-' + hex(0x100000 + i);
      const act = '00000000-0000-4000-8000-' + hex(0x200000 + i);
      await feed(i + 1, rr, act, 'started', 1);
    }
    const runner = new ProjectionRunnerService(testDb.db);
    const rebuild = new ProjectionRebuildService(testDb.db, runner);
    await rebuild.rebuild(COMPANY);
    const cnt = rowsOf<{ n: string }>(
      (await testDb.db.execute(
        sql`SELECT count(*)::text AS n FROM dispatch_board_projection WHERE deleted_at IS NULL`,
      )) as unknown as { rows: readonly { n: string }[] },
    );
    expect(Number(cnt[0]?.n)).toBe(250);
  });
});
