// apps/api/test/repair-complete-delivered-runs.integration.test.ts
// RED-first (T16 completion-reconciler arc): a road_run stranded in a
// non-terminal state whose linked transport_orders are ALL fully
// photo-committed (committed manifests >= stop count -- the SAME predicate
// the live completion gate assertAllManifestsCommitted enforces) must be
// driven started->completed through appendTriWrite, so the projection
// runner heals dispatch_board and the order leaves Dang chay. Heals the
// legacy cohort stranded when the intake pipeline lagged (manifests
// committed late, after the client complete-intent window) or when the old
// departedAt-proxy made complete unreachable (prod XTT.07-020: run
// 165be7fe started, 2 committed manifests, no completed event).
//
// 2026 self-healing reconciliation (AWS/Azure/EventSourcingDB): level-
// triggered (find delivered-but-incomplete runs regardless of WHY missed),
// idempotent (a second execute finds nothing), server-authoritative (the
// existing committed>=stops gate is the completion predicate, never forced).
//
// Discriminating seed: DELIVERED run (2 stops, 2 committed manifests) ->
// MUST complete + emit road_run.completed. INCOMPLETE run (2 stops, 1
// committed) -> MUST be excluded (gate parity). DONE run (already
// completed) -> not found (idempotency). Fails at import until
// repair-complete-delivered-runs.ts lands.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and, gt } from 'drizzle-orm';
import {
  findDeliveredIncompleteRuns,
  repairCompleteDeliveredRuns,
} from '../src/maintenance/repair-complete-delivered-runs.js';
import { vehicle } from '../src/database/schema/reference.js';
import {
  roadRun,
  transportOrder,
  roadRunTransportOrder,
  stop,
} from '../src/database/schema/transport.js';
import { manifest } from '../src/database/schema/manifest.js';
import { syncChangeFeed, outbox } from '../src/database/schema/index.js';
import {
  startPgliteTestDb,
  stopPgliteTestDb,
  type PgliteTestDb,
} from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';

let testDb: PgliteTestDb;

function tenancy(op: ReturnType<typeof createOperatorContext>): {
  companyId: string;
  businessUnitId: string;
  depotId: string;
  legalEntityId: string;
} {
  return {
    companyId: op.companyId,
    businessUnitId: op.businessUnitId,
    depotId: op.depotId,
    legalEntityId: op.legalEntityId,
  };
}

interface Seeded {
  readonly deliveredRunId: string;
  readonly incompleteRunId: string;
  readonly doneRunId: string;
}

// Seed a started road_run bound to one transport_order carrying stopCount
// stops and committedCount committed manifests (one manifest per stop, state
// committed for the first committedCount stops). Mirrors the real create
// shape (order -> stops -> manifests linked by transportOrderId + stopId).
async function seedRun(
  tx: TestTx,
  op: ReturnType<typeof createOperatorContext>,
  plate: string,
  operatorId: string,
  runState: 'started' | 'completed',
  stopCount: number,
  committedCount: number,
): Promise<string> {
  const tn = tenancy(op);
  const [v] = await tx
    .insert(vehicle)
    .values({ ...tn, plate, active: true })
    .returning();
  if (!v) throw new Error('vehicle seed failed');
  const [rr] = await tx
    .insert(roadRun)
    .values({
      ...tn,
      state: runState,
      assignedOperatorId: operatorId,
      assignedAssetId: v.vehicleId,
      startedAt: new Date(),
      completedAt: runState === 'completed' ? new Date() : null,
    })
    .returning();
  const [o] = await tx
    .insert(transportOrder)
    .values({ ...tn, state: 'draft' })
    .returning();
  if (!rr || !o) throw new Error('run/order seed failed');
  await tx.insert(roadRunTransportOrder).values({
    ...tn,
    roadRunId: rr.roadRunId,
    transportOrderId: o.transportOrderId,
    sequence: 1,
  });
  for (let i = 0; i < stopCount; i += 1) {
    const [s] = await tx
      .insert(stop)
      .values({
        ...tn,
        transportOrderId: o.transportOrderId,
        sequence: i + 1,
        stopType: i === 0 ? 'pickup' : 'delivery',
      })
      .returning();
    if (!s) throw new Error('stop seed failed');
    await tx.insert(manifest).values({
      ...tn,
      transportOrderId: o.transportOrderId,
      stopId: s.stopId,
      manifestCorrelationId: crypto.randomUUID(),
      state: i < committedCount ? 'committed' : 'pending',
      committedAt: i < committedCount ? new Date() : null,
    });
  }
  return rr.roadRunId;
}

async function seedFleet(
  tx: TestTx,
  op: ReturnType<typeof createOperatorContext>,
): Promise<Seeded> {
  const deliveredRunId = await seedRun(
    tx,
    op,
    'RC-DELIV-01',
    '00000000-0000-0000-0000-000000030001',
    'started',
    2,
    2,
  );
  const incompleteRunId = await seedRun(
    tx,
    op,
    'RC-INCMP-01',
    '00000000-0000-0000-0000-000000030002',
    'started',
    2,
    1,
  );
  const doneRunId = await seedRun(
    tx,
    op,
    'RC-DONE-01',
    '00000000-0000-0000-0000-000000030003',
    'completed',
    2,
    2,
  );
  return { deliveredRunId, incompleteRunId, doneRunId };
}

describe('@fleet/api - repairCompleteDeliveredRuns (compensating road_run.completed events)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });

  it('findDeliveredIncompleteRuns returns exactly the delivered (fully committed) started run', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const seeded = await seedFleet(tx, op);
      const rows = await findDeliveredIncompleteRuns(tx as never, op.companyId);
      return { rows, seeded };
    });
    const ids = (result?.rows ?? []).map((r) => r.roadRunId).sort();
    expect(ids).toEqual([result?.seeded.deliveredRunId].sort());
  });

  it('dry-run (default) reports findings and mutates nothing', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const seeded = await seedFleet(tx, op);
      const res = await repairCompleteDeliveredRuns(tx as never, op);
      const [after] = await tx
        .select({ state: roadRun.state })
        .from(roadRun)
        .where(eq(roadRun.roadRunId, seeded.deliveredRunId));
      const feedRows = await tx
        .select({ feedId: syncChangeFeed.feedId })
        .from(syncChangeFeed)
        .where(
          and(
            eq(syncChangeFeed.companyId, op.companyId),
            eq(syncChangeFeed.aggregateType, 'road_run'),
          ),
        );
      return { res, state: after?.state, feedCount: feedRows.length };
    });
    expect(result?.res.dryRun).toBe(true);
    expect(result?.res.found).toBe(1);
    expect(result?.res.repaired).toBe(0);
    expect(result?.state).toBe('started');
    expect(result?.feedCount).toBe(0);
  });

  it('execute completes delivered runs, appends road_run.completed feed + outbox rows, leaves incomplete + done untouched, and is idempotent', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const seeded = await seedFleet(tx, op);
      const [{ serverSeq: maxBefore } = { serverSeq: 0n }] = await tx
        .select({ serverSeq: syncChangeFeed.serverSeq })
        .from(syncChangeFeed)
        .where(eq(syncChangeFeed.companyId, op.companyId))
        .orderBy(syncChangeFeed.serverSeq);
      const beforeSeq = typeof maxBefore === 'bigint' ? maxBefore : 0n;
      const res = await repairCompleteDeliveredRuns(tx as never, op, { execute: true });
      const states = Object.fromEntries(
        (
          await tx
            .select({ id: roadRun.roadRunId, state: roadRun.state })
            .from(roadRun)
            .where(eq(roadRun.companyId, op.companyId))
        ).map((r) => [r.id, r.state]),
      );
      const feedRows = await tx
        .select({
          aggregateId: syncChangeFeed.aggregateId,
          delta: syncChangeFeed.delta,
        })
        .from(syncChangeFeed)
        .where(
          and(
            eq(syncChangeFeed.companyId, op.companyId),
            eq(syncChangeFeed.aggregateType, 'road_run'),
            gt(syncChangeFeed.serverSeq, beforeSeq),
          ),
        );
      const outboxRows = await tx
        .select({ queueName: outbox.queueName })
        .from(outbox)
        .where(eq(outbox.companyId, op.companyId));
      const again = await repairCompleteDeliveredRuns(tx as never, op, { execute: true });
      return { res, states, feedRows, outboxRows, again, seeded };
    });
    expect(result?.res.dryRun).toBe(false);
    expect(result?.res.found).toBe(1);
    expect(result?.res.repaired).toBe(1);
    expect(result?.states[result.seeded.deliveredRunId]).toBe('completed');
    expect(result?.states[result.seeded.incompleteRunId]).toBe('started');
    expect(result?.states[result.seeded.doneRunId]).toBe('completed');
    const completedFor = (id: string): boolean =>
      (result?.feedRows ?? []).some((e) => {
        const d = e.delta as { state?: unknown };
        return e.aggregateId === id && d.state === 'completed';
      });
    expect(completedFor(result?.seeded.deliveredRunId ?? '')).toBe(true);
    expect(completedFor(result?.seeded.incompleteRunId ?? '')).toBe(false);
    expect((result?.outboxRows ?? []).filter((o) => o.queueName === 'projections').length).toBe(1);
    expect(result?.again.found).toBe(0);
    expect(result?.again.repaired).toBe(0);
  });
  it('excludes an orphan non-terminal run with zero linked orders (runIsDelivered false branch)', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const tn = tenancy(op);
      const [v] = await tx
        .insert(vehicle)
        .values({ ...tn, plate: 'RC-ORPH-01', active: true })
        .returning();
      if (!v) throw new Error('vehicle seed failed');
      const [rr] = await tx
        .insert(roadRun)
        .values({
          ...tn,
          state: 'started',
          assignedOperatorId: '00000000-0000-0000-0000-000000030009',
          assignedAssetId: v.vehicleId,
          startedAt: new Date(),
        })
        .returning();
      if (!rr) throw new Error('run seed failed');
      const rows = await findDeliveredIncompleteRuns(tx as never, op.companyId);
      return { rows, orphanId: rr.roadRunId };
    });
    const ids = (result?.rows ?? []).map((r) => r.roadRunId);
    expect(ids).not.toContain(result?.orphanId);
  });

  it('execute with no delivered runs returns found:0 repaired:0 and mutates nothing (empty-set branch)', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const tn = tenancy(op);
      const [v] = await tx
        .insert(vehicle)
        .values({ ...tn, plate: 'RC-NONE-01', active: true })
        .returning();
      if (!v) throw new Error('vehicle seed failed');
      const [rr] = await tx
        .insert(roadRun)
        .values({
          ...tn,
          state: 'started',
          assignedOperatorId: '00000000-0000-0000-0000-000000030010',
          assignedAssetId: v.vehicleId,
          startedAt: new Date(),
        })
        .returning();
      const [o] = await tx
        .insert(transportOrder)
        .values({ ...tn, state: 'draft' })
        .returning();
      if (!rr || !o) throw new Error('seed failed');
      await tx.insert(roadRunTransportOrder).values({
        ...tn,
        roadRunId: rr.roadRunId,
        transportOrderId: o.transportOrderId,
        sequence: 1,
      });
      const [s] = await tx
        .insert(stop)
        .values({
          ...tn,
          transportOrderId: o.transportOrderId,
          sequence: 1,
          stopType: 'delivery',
        })
        .returning();
      if (!s) throw new Error('stop seed failed');
      const res = await repairCompleteDeliveredRuns(tx as never, op, { execute: true });
      const [after] = await tx
        .select({ state: roadRun.state })
        .from(roadRun)
        .where(eq(roadRun.roadRunId, rr.roadRunId));
      const feedRows = await tx
        .select({ feedId: syncChangeFeed.feedId })
        .from(syncChangeFeed)
        .where(
          and(
            eq(syncChangeFeed.companyId, op.companyId),
            eq(syncChangeFeed.aggregateType, 'road_run'),
          ),
        );
      return { res, state: after?.state, feedCount: feedRows.length };
    });
    expect(result?.res.dryRun).toBe(false);
    expect(result?.res.found).toBe(0);
    expect(result?.res.repaired).toBe(0);
    expect(result?.state).toBe('started');
    expect(result?.feedCount).toBe(0);
  });
});
