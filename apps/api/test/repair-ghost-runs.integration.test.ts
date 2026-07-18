// apps/api/test/repair-ghost-runs.integration.test.ts
// RED-first (T9 ghost-run repair arc, 2026-07-11): the committed repair
// tool must (a) FIND every non-terminal road_run with zero LIVE linked
// transport_orders (ghosts: all orders terminal; orphans: no links),
// (b) mutate NOTHING on dry-run, (c) on execute flip each such run to
// cancelled AND append road_run.cancelled through appendTriWrite
// (sync_change_feed + outbox queue projections) exactly like
// cascadeCancelLinkedRoadRuns, (d) leave live-busy runs untouched, and
// (e) be idempotent: a second execute finds nothing. Mirrors prod run
// dd964ecd / order XTT.06-002 (cancelled via admin-drivers-update raw
// path, run never terminated, no event in feed).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and, gt } from 'drizzle-orm';
import { findGhostRuns, repairGhostRuns } from '../src/maintenance/repair-ghost-runs.js';
import { vehicle } from '../src/database/schema/reference.js';
import { roadRun, transportOrder, roadRunTransportOrder } from '../src/database/schema/transport.js';
import { syncChangeFeed, outbox } from '../src/database/schema/index.js';
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
interface Seeded {
  readonly ghostRunId: string;
  readonly orphanRunId: string;
  readonly liveRunId: string;
  readonly doneRunId: string;
}
async function seedFleet(tx: TestTx, op: ReturnType<typeof createOperatorContext>): Promise<Seeded> {
  const tn = tenancy(op);
  const [vGhost] = await tx.insert(vehicle).values({ ...tn, plate: 'RG-GHOST-01', active: true }).returning();
  const [vOrphan] = await tx.insert(vehicle).values({ ...tn, plate: 'RG-ORPH-01', active: true }).returning();
  const [vLive] = await tx.insert(vehicle).values({ ...tn, plate: 'RG-LIVE-01', active: true }).returning();
  const [vDone] = await tx.insert(vehicle).values({ ...tn, plate: 'RG-DONE-01', active: true }).returning();
  if (!vGhost || !vOrphan || !vLive || !vDone) throw new Error('vehicle seed failed');
  // GHOST: started run, only linked order cancelled (prod dd964ecd shape).
  const [rrGhost] = await tx.insert(roadRun).values({
    ...tn, state: 'started',
    assignedOperatorId: '00000000-0000-0000-0000-000000020001', assignedAssetId: vGhost.vehicleId,
  }).returning();
  const [oCancelled] = await tx.insert(transportOrder).values({
    ...tn, state: 'cancelled', cancelledAt: new Date(),
  }).returning();
  if (!rrGhost || !oCancelled) throw new Error('ghost seed failed');
  await tx.insert(roadRunTransportOrder).values({
    ...tn, roadRunId: rrGhost.roadRunId, transportOrderId: oCancelled.transportOrderId, sequence: 1,
  });
  // ORPHAN: planned run, zero links (Jul-05 teardown class).
  const [rrOrphan] = await tx.insert(roadRun).values({
    ...tn, state: 'planned',
    assignedOperatorId: '00000000-0000-0000-0000-000000020002', assignedAssetId: vOrphan.vehicleId,
  }).returning();
  // LIVE control: started run with a live (draft) order -- must stay untouched.
  const [rrLive] = await tx.insert(roadRun).values({
    ...tn, state: 'started',
    assignedOperatorId: '00000000-0000-0000-0000-000000020003', assignedAssetId: vLive.vehicleId,
  }).returning();
  const [oLive] = await tx.insert(transportOrder).values({ ...tn }).returning();
  if (!rrOrphan || !rrLive || !oLive) throw new Error('live seed failed');
  await tx.insert(roadRunTransportOrder).values({
    ...tn, roadRunId: rrLive.roadRunId, transportOrderId: oLive.transportOrderId, sequence: 1,
  });
  // DONE control: already-cancelled run with cancelled order -- not a ghost.
  const [rrDone] = await tx.insert(roadRun).values({
    ...tn, state: 'cancelled',
    assignedOperatorId: '00000000-0000-0000-0000-000000020004', assignedAssetId: vDone.vehicleId,
  }).returning();
  const [oDone] = await tx.insert(transportOrder).values({
    ...tn, state: 'cancelled', cancelledAt: new Date(),
  }).returning();
  if (!rrDone || !oDone) throw new Error('done seed failed');
  await tx.insert(roadRunTransportOrder).values({
    ...tn, roadRunId: rrDone.roadRunId, transportOrderId: oDone.transportOrderId, sequence: 1,
  });
  return {
    ghostRunId: rrGhost.roadRunId, orphanRunId: rrOrphan.roadRunId,
    liveRunId: rrLive.roadRunId, doneRunId: rrDone.roadRunId,
  };
}
describe('@fleet/api - repairGhostRuns (compensating road_run.cancelled events)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('findGhostRuns returns exactly the ghost and the orphan', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const seeded = await seedFleet(tx, op);
      const rows = await findGhostRuns(tx as never, op.companyId);
      return { rows, seeded };
    });
    const ids = (result?.rows ?? []).map((r) => r.roadRunId).sort();
    expect(ids).toEqual([result?.seeded.ghostRunId, result?.seeded.orphanRunId].sort());
  });
  it('dry-run (default) reports findings and mutates nothing', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const seeded = await seedFleet(tx, op);
      const res = await repairGhostRuns(tx as never, op);
      const [ghostAfter] = await tx.select({ state: roadRun.state }).from(roadRun)
        .where(eq(roadRun.roadRunId, seeded.ghostRunId));
      const feedRows = await tx.select({ feedId: syncChangeFeed.feedId }).from(syncChangeFeed)
        .where(and(eq(syncChangeFeed.companyId, op.companyId), eq(syncChangeFeed.aggregateType, 'road_run')));
      return { res, ghostState: ghostAfter?.state, feedCount: feedRows.length };
    });
    expect(result?.res.dryRun).toBe(true);
    expect(result?.res.found).toBe(2);
    expect(result?.res.repaired).toBe(0);
    expect(result?.ghostState).toBe('started');
    expect(result?.feedCount).toBe(0);
  });
  it('execute cancels ghosts, appends road_run.cancelled feed + outbox rows, leaves live and done untouched, and is idempotent', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const seeded = await seedFleet(tx, op);
      const [{ serverSeq: maxBefore } = { serverSeq: 0n }] = await tx
        .select({ serverSeq: syncChangeFeed.serverSeq }).from(syncChangeFeed)
        .where(eq(syncChangeFeed.companyId, op.companyId)).orderBy(syncChangeFeed.serverSeq);
      const beforeSeq = typeof maxBefore === 'bigint' ? maxBefore : 0n;
      const res = await repairGhostRuns(tx as never, op, { execute: true });
      const states = Object.fromEntries((await tx.select({ id: roadRun.roadRunId, state: roadRun.state })
        .from(roadRun).where(eq(roadRun.companyId, op.companyId))).map((r) => [r.id, r.state]));
      const feedRows = await tx.select({
        aggregateId: syncChangeFeed.aggregateId, delta: syncChangeFeed.delta,
      }).from(syncChangeFeed).where(and(
        eq(syncChangeFeed.companyId, op.companyId),
        eq(syncChangeFeed.aggregateType, 'road_run'),
        gt(syncChangeFeed.serverSeq, beforeSeq),
      ));
      const outboxRows = await tx.select({ queueName: outbox.queueName }).from(outbox)
        .where(eq(outbox.companyId, op.companyId));
      const again = await repairGhostRuns(tx as never, op, { execute: true });
      return { res, states, feedRows, outboxRows, again, seeded };
    });
    expect(result?.res.dryRun).toBe(false);
    expect(result?.res.found).toBe(2);
    expect(result?.res.repaired).toBe(2);
    expect(result?.states[result.seeded.ghostRunId]).toBe('cancelled');
    expect(result?.states[result.seeded.orphanRunId]).toBe('cancelled');
    expect(result?.states[result.seeded.liveRunId]).toBe('started');
    expect(result?.states[result.seeded.doneRunId]).toBe('cancelled');
    const cancelledFor = (id: string): boolean => (result?.feedRows ?? []).some((e) => {
      const d = e.delta as { state?: unknown };
      return e.aggregateId === id && d.state === 'cancelled';
    });
    expect(cancelledFor(result?.seeded.ghostRunId ?? '')).toBe(true);
    expect(cancelledFor(result?.seeded.orphanRunId ?? '')).toBe(true);
    expect(cancelledFor(result?.seeded.liveRunId ?? '')).toBe(false);
    expect((result?.outboxRows ?? []).filter((o) => o.queueName === 'projections').length).toBe(2);
    expect(result?.again.found).toBe(0);
    expect(result?.again.repaired).toBe(0);
  });
});
