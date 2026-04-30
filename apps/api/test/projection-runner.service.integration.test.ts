// apps/api/test/projection-runner.service.integration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { ProjectionRunnerService } from '../src/projections/projection-runner.service.js';
import { startMigratedTestDb, stopMigratedTestDb, type MigratedTestDb } from './helpers/migrate-test-db.js';
import { rowsOf } from './helpers/integration-rows.js';

let testDb: MigratedTestDb;
const COMPANY = '00000000-0000-0000-0000-000000000003';
const BU = '00000000-0000-0000-0000-000000000004';
const DEPOT = '00000000-0000-0000-0000-000000000005';
const LE = '00000000-0000-0000-0000-000000000006';
const ROAD_RUN_ID = '00000000-0000-0000-0000-000000000010';
const ACTION_1 = '00000000-0000-0000-0000-0000000000a1';
const ACTION_2 = '00000000-0000-0000-0000-0000000000a2';

describe('@fleet/api - ProjectionRunnerService (integration)', () => {
  beforeAll(async () => { testDb = await startMigratedTestDb('fleet_proj_runner_int'); }, 90_000);
  afterAll(async () => { await stopMigratedTestDb(testDb); });
  beforeEach(async () => {
    await testDb.db.execute(sql`TRUNCATE TABLE sync_change_feed, dispatch_board_projection, projection_status CASCADE`);
  });

  it('materializes dispatch_board_projection from a road_run delta', async () => {
    await testDb.db.execute(sql`
      INSERT INTO sync_change_feed (feed_id, company_id, business_unit_id, depot_id, legal_entity_id, server_seq, action_id, aggregate_type, aggregate_id, delta, created_at)
      VALUES (gen_random_uuid(), ${COMPANY}, ${BU}, ${DEPOT}, ${LE}, 1, ${ACTION_1}, 'road_run', ${ROAD_RUN_ID},
              jsonb_build_object('roadRunId', ${ROAD_RUN_ID}::text, 'state', 'started', 'serverSeq', 1, 'assignedOperatorId', null, 'assignedAssetId', null, 'plannedStartAt', '2026-04-29T08:00:00.000Z', 'stopCount', 2, 'transportOrderRefs', jsonb_build_array('TO-1')),
              now())
    `);
    const svc = new ProjectionRunnerService(testDb.db);
    const result = await svc.drainOnce(COMPANY);
    expect(result.applied).toBe(1);
    const r = rowsOf<{ state: string }>(await testDb.db.execute(sql`SELECT state FROM dispatch_board_projection WHERE road_run_id = ${ROAD_RUN_ID}`) as unknown as { rows: readonly { state: string }[] });
    expect(r[0]?.state).toBe('started');
  });

  it('advances watermark in projection_status', async () => {
    await testDb.db.execute(sql`
      INSERT INTO sync_change_feed (feed_id, company_id, business_unit_id, depot_id, legal_entity_id, server_seq, action_id, aggregate_type, aggregate_id, delta, created_at)
      VALUES (gen_random_uuid(), ${COMPANY}, ${BU}, ${DEPOT}, ${LE}, 5, ${ACTION_1}, 'road_run', ${ROAD_RUN_ID},
              jsonb_build_object('roadRunId', ${ROAD_RUN_ID}::text, 'state', 'started', 'serverSeq', 5, 'assignedOperatorId', null, 'assignedAssetId', null, 'plannedStartAt', '2026-04-29T08:00:00.000Z', 'stopCount', 1, 'transportOrderRefs', jsonb_build_array()),
              now())
    `);
    const svc = new ProjectionRunnerService(testDb.db);
    await svc.drainOnce(COMPANY);
    const r = rowsOf<{ watermark: string }>(await testDb.db.execute(sql`SELECT watermark FROM projection_status WHERE projection_name = 'dispatch_board' AND scope = ${COMPANY}`) as unknown as { rows: readonly { watermark: string }[] });
    expect(String(r[0]?.watermark)).toBe('5');
  });

  it('idempotent: second drain on same events produces no change', async () => {
    await testDb.db.execute(sql`
      INSERT INTO sync_change_feed (feed_id, company_id, business_unit_id, depot_id, legal_entity_id, server_seq, action_id, aggregate_type, aggregate_id, delta, created_at)
      VALUES (gen_random_uuid(), ${COMPANY}, ${BU}, ${DEPOT}, ${LE}, 1, ${ACTION_1}, 'road_run', ${ROAD_RUN_ID},
              jsonb_build_object('roadRunId', ${ROAD_RUN_ID}::text, 'state', 'started', 'serverSeq', 1, 'assignedOperatorId', null, 'assignedAssetId', null, 'plannedStartAt', '2026-04-29T08:00:00.000Z', 'stopCount', 1, 'transportOrderRefs', jsonb_build_array()),
              now())
    `);
    const svc = new ProjectionRunnerService(testDb.db);
    await svc.drainOnce(COMPANY);
    const second = await svc.drainOnce(COMPANY);
    expect(second.applied).toBe(0);
    // #702: stronger - no duplicate row, watermark stable
    const projRows = rowsOf<{ road_run_id: string }>(await testDb.db.execute(sql`SELECT road_run_id FROM dispatch_board_projection`) as unknown as { rows: readonly { road_run_id: string }[] });
    expect(projRows).toHaveLength(1);
    const wmRows = rowsOf<{ watermark: string }>(await testDb.db.execute(sql`SELECT watermark FROM projection_status WHERE scope = ${COMPANY}`) as unknown as { rows: readonly { watermark: string }[] });
    expect(String(wmRows[0]?.watermark)).toBe('1');
  });

  it('applies events in server_seq order; final state reflects highest seq (#705)', async () => {
    await testDb.db.execute(sql`
      INSERT INTO sync_change_feed (feed_id, company_id, business_unit_id, depot_id, legal_entity_id, server_seq, action_id, aggregate_type, aggregate_id, delta, created_at)
      VALUES (gen_random_uuid(), ${COMPANY}, ${BU}, ${DEPOT}, ${LE}, 1, ${ACTION_1}, 'road_run', ${ROAD_RUN_ID},
              jsonb_build_object('roadRunId', ${ROAD_RUN_ID}::text, 'state', 'planned', 'serverSeq', 1, 'assignedOperatorId', null, 'assignedAssetId', null, 'plannedStartAt', '2026-04-29T08:00:00.000Z', 'stopCount', 1, 'transportOrderRefs', jsonb_build_array()),
              now()),
             (gen_random_uuid(), ${COMPANY}, ${BU}, ${DEPOT}, ${LE}, 2, ${ACTION_2}, 'road_run', ${ROAD_RUN_ID},
              jsonb_build_object('roadRunId', ${ROAD_RUN_ID}::text, 'state', 'started', 'serverSeq', 2),
              now())
    `);
    const svc = new ProjectionRunnerService(testDb.db);
    const result = await svc.drainOnce(COMPANY);
    expect(result.applied).toBe(2);
    const r = rowsOf<{ state: string }>(await testDb.db.execute(sql`SELECT state FROM dispatch_board_projection WHERE road_run_id = ${ROAD_RUN_ID}`) as unknown as { rows: readonly { state: string }[] });
    expect(r[0]?.state).toBe('started');
    const w = rowsOf<{ watermark: string }>(await testDb.db.execute(sql`SELECT watermark FROM projection_status WHERE scope = ${COMPANY}`) as unknown as { rows: readonly { watermark: string }[] });
    expect(String(w[0]?.watermark)).toBe('2');
  });

  it('isolates scope: events in OTHER_SCOPE do not materialize for COMPANY (#704)', async () => {
    const OTHER = '00000000-0000-0000-0000-0000000000ff';
    await testDb.db.execute(sql`
      INSERT INTO sync_change_feed (feed_id, company_id, business_unit_id, depot_id, legal_entity_id, server_seq, action_id, aggregate_type, aggregate_id, delta, created_at)
      VALUES (gen_random_uuid(), ${OTHER}, ${BU}, ${DEPOT}, ${LE}, 1, ${ACTION_1}, 'road_run', ${ROAD_RUN_ID},
              jsonb_build_object('roadRunId', ${ROAD_RUN_ID}::text, 'state', 'started', 'serverSeq', 1, 'assignedOperatorId', null, 'assignedAssetId', null, 'plannedStartAt', '2026-04-29T08:00:00.000Z', 'stopCount', 1, 'transportOrderRefs', jsonb_build_array()),
              now())
    `);
    const svc = new ProjectionRunnerService(testDb.db);
    const result = await svc.drainOnce(COMPANY);
    expect(result.applied).toBe(0);
    const r = rowsOf<{ road_run_id: string }>(await testDb.db.execute(sql`SELECT road_run_id FROM dispatch_board_projection`) as unknown as { rows: readonly { road_run_id: string }[] });
    expect(r).toHaveLength(0);
  });
});
