// apps/api/test/completion-stranded.repo.integration.test.ts
// RED-first (completion-reconciler guard arc, slice S): the Drizzle read port that
// feeds CompletionReconcilerMonitorService. oldestStrandedDeliveredRun() must
// return the OLDEST (by startedAt) non-terminal road_run that is fully delivered
// (all stop photos committed -- the SAME predicate as findDeliveredIncompleteRuns,
// reused so the monitor and the reactive repair stay in lockstep), with its
// startedAt + the stranded-run count; null when none. Discriminating seed: two
// delivered runs with distinct startedAt (older must win) + one non-delivered run
// (must be excluded). PGlite harness mirrors repair-complete-delivered-runs
// integration. Fails at import until completion-stranded.repo.ts lands.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DrizzleCompletionStrandedRepo } from '../src/maintenance/completion-stranded.repo.js';
import { vehicle } from '../src/database/schema/reference.js';
import { roadRun, transportOrder, roadRunTransportOrder, stop } from '../src/database/schema/transport.js';
import { manifest } from '../src/database/schema/manifest.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
function tenancy(op: ReturnType<typeof createOperatorContext>): {
  companyId: string; businessUnitId: string; depotId: string; legalEntityId: string;
} {
  return {
    companyId: op.companyId, businessUnitId: op.businessUnitId,
    depotId: op.depotId, legalEntityId: op.legalEntityId,
  };
}
// Seed a started road_run (with an explicit startedAt) bound to one order carrying
// stopCount stops and committedCount committed manifests. Returns its id.
async function seedRun(
  tx: TestTx,
  op: ReturnType<typeof createOperatorContext>,
  plate: string,
  operatorId: string,
  startedAt: Date,
  stopCount: number,
  committedCount: number,
): Promise<string> {
  const tn = tenancy(op);
  const [v] = await tx.insert(vehicle).values({ ...tn, plate, active: true }).returning();
  if (!v) throw new Error('vehicle seed failed');
  const [rr] = await tx.insert(roadRun).values({
    ...tn, state: 'started',
    assignedOperatorId: operatorId, assignedAssetId: v.vehicleId,
    startedAt,
  }).returning();
  const [ord] = await tx.insert(transportOrder).values({ ...tn, state: 'draft' }).returning();
  if (!rr || !ord) throw new Error('run/order seed failed');
  await tx.insert(roadRunTransportOrder).values({
    ...tn, roadRunId: rr.roadRunId, transportOrderId: ord.transportOrderId, sequence: 1,
  });
  for (let i = 0; i < stopCount; i += 1) {
    const [s] = await tx.insert(stop).values({
      ...tn, transportOrderId: ord.transportOrderId, sequence: i + 1,
      stopType: i === 0 ? 'pickup' : 'delivery',
    }).returning();
    if (!s) throw new Error('stop seed failed');
    await tx.insert(manifest).values({
      ...tn, transportOrderId: ord.transportOrderId, stopId: s.stopId,
      manifestCorrelationId: crypto.randomUUID(),
      state: i < committedCount ? 'committed' : 'pending',
      committedAt: i < committedCount ? new Date() : null,
    });
  }
  return rr.roadRunId;
}
describe('@fleet/api - DrizzleCompletionStrandedRepo', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('returns the OLDEST delivered stranded run with startedAt + stranded count', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const older = new Date('2026-07-11T03:00:00.000Z');
      const newer = new Date('2026-07-11T09:00:00.000Z');
      const olderId = await seedRun(tx, op, 'CS-OLD-01', '00000000-0000-0000-0000-000000031001', older, 2, 2);
      await seedRun(tx, op, 'CS-NEW-01', '00000000-0000-0000-0000-000000031002', newer, 2, 2);
      await seedRun(tx, op, 'CS-INCMP-01', '00000000-0000-0000-0000-000000031003', older, 2, 1);
      const repo = new DrizzleCompletionStrandedRepo(tx as never, op.companyId);
      const row = await repo.oldestStrandedDeliveredRun();
      return { row, olderId, older };
    });
    expect(result?.row?.roadRunId).toBe(result?.olderId);
    expect(result?.row?.startedAt.getTime()).toBe(result?.older.getTime());
    expect(result?.row?.strandedCount).toBe(2);
  });
  it('returns null when no delivered run is stranded (only an incomplete run present)', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      await seedRun(tx, op, 'CS-INCMP-02', '00000000-0000-0000-0000-000000031004', new Date(), 2, 1);
      const repo = new DrizzleCompletionStrandedRepo(tx as never, op.companyId);
      return { row: await repo.oldestStrandedDeliveredRun() };
    });
    expect(result?.row).toBeNull();
  });
});
