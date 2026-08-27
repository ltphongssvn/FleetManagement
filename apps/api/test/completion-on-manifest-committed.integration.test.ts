// apps/api/test/completion-on-manifest-committed.integration.test.ts
// RED-first (edge-triggered completion arc, terminal 29): the batch
// reconciler repairCompleteDeliveredRuns heals stranded runs after the fact
// (level-triggered backstop). This test pins the DURABLE root fix: completion
// must fire the INSTANT the final manifest commits, via the server-side
// finalizeIntake path -- no client complete-intent window, no periodic sweep.
// 2026 process-manager pattern (Event-Driven.io / saga): re-evaluate
// completion on the downstream manifest.committed event rather than a
// one-time client trigger, so late-committing photos self-heal.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { ManifestService } from '../src/manifest/manifest.service.js';
import { completeRunIfDelivered } from '../src/maintenance/repair-complete-delivered-runs.js';
import { vehicle } from '../src/database/schema/reference.js';
import {
  roadRun,
  transportOrder,
  roadRunTransportOrder,
  stop,
} from '../src/database/schema/transport.js';
import { manifest, uploadSession } from '../src/database/schema/manifest.js';
import { syncChangeFeed } from '../src/database/schema/index.js';
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

const blobsFake = {} as never;
const configFake = { getOrThrow: () => 3600 } as never;

interface SeededStop {
  readonly stopId: string;
  readonly manifestId: string;
  readonly uploadSessionId: string;
}
interface Seeded {
  readonly roadRunId: string;
  readonly transportOrderId: string;
  readonly stops: readonly SeededStop[];
}

// Seed a started run whose order has stopCount stops; the first committedCount
// manifests are committed, the rest left verifying WITH a verifying upload
// session, ready for a real finalizeIntake commit to drive them to committed.
async function seedRun(
  tx: TestTx,
  op: ReturnType<typeof createOperatorContext>,
  operatorId: string,
  stopCount: number,
  committedCount: number,
): Promise<Seeded> {
  const tn = tenancy(op);
  const [v] = await tx
    .insert(vehicle)
    .values({ ...tn, plate: 'CO-COMMIT-01', active: true })
    .returning();
  if (!v) throw new Error('vehicle seed failed');
  const [rr] = await tx
    .insert(roadRun)
    .values({
      ...tn,
      state: 'started',
      assignedOperatorId: operatorId,
      assignedAssetId: v.vehicleId,
      startedAt: new Date(),
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
  const stops: SeededStop[] = [];
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
    const committed = i < committedCount;
    const [m] = await tx
      .insert(manifest)
      .values({
        ...tn,
        transportOrderId: o.transportOrderId,
        stopId: s.stopId,
        manifestCorrelationId: crypto.randomUUID(),
        state: committed ? 'committed' : 'verifying',
        committedAt: committed ? new Date() : null,
      })
      .returning();
    if (!m) throw new Error('manifest seed failed');
    const [us] = await tx
      .insert(uploadSession)
      .values({
        ...tn,
        manifestId: m.manifestId,
        operatorId,
        s3Key: 'k/' + s.stopId,
        s3Bucket: 'b',
        contentType: 'image/jpeg',
        state: committed ? 'committed' : 'verifying',
        committedAt: committed ? new Date() : null,
      })
      .returning();
    if (!us) throw new Error('upload_session seed failed');
    stops.push({ stopId: s.stopId, manifestId: m.manifestId, uploadSessionId: us.uploadSessionId });
  }
  return { roadRunId: rr.roadRunId, transportOrderId: o.transportOrderId, stops };
}

describe('@fleet/api - completion fires on manifest.committed (edge-triggered)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });

  it('committing the FINAL manifest via finalizeIntake completes the run + appends road_run.completed', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const seeded = await seedRun(tx, op, '00000000-0000-0000-0000-000000031001', 2, 1);
      const svc = new ManifestService(tx as never, blobsFake, configFake);
      const last = seeded.stops[seeded.stops.length - 1];
      if (!last) throw new Error('no last stop');
      await svc.finalizeIntake({ uploadSessionId: last.uploadSessionId, accepted: true }, op);
      const [after] = await tx
        .select({ state: roadRun.state })
        .from(roadRun)
        .where(eq(roadRun.roadRunId, seeded.roadRunId));
      const feed = await tx
        .select({ aggregateId: syncChangeFeed.aggregateId, delta: syncChangeFeed.delta })
        .from(syncChangeFeed)
        .where(
          and(
            eq(syncChangeFeed.companyId, op.companyId),
            eq(syncChangeFeed.aggregateType, 'road_run'),
          ),
        );
      return { state: after?.state, feed, roadRunId: seeded.roadRunId };
    });
    expect(result?.state).toBe('completed');
    const completed = (result?.feed ?? []).some((e) => {
      const d = e.delta as { state?: unknown };
      return e.aggregateId === result?.roadRunId && d.state === 'completed';
    });
    expect(completed).toBe(true);
  });

  it('committing a manifest when photos are STILL missing leaves the run started (gate parity)', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const seeded = await seedRun(tx, op, '00000000-0000-0000-0000-000000031002', 3, 1);
      const svc = new ManifestService(tx as never, blobsFake, configFake);
      const mid = seeded.stops[1];
      if (!mid) throw new Error('no mid stop');
      await svc.finalizeIntake({ uploadSessionId: mid.uploadSessionId, accepted: true }, op);
      const [after] = await tx
        .select({ state: roadRun.state })
        .from(roadRun)
        .where(eq(roadRun.roadRunId, seeded.roadRunId));
      return { state: after?.state };
    });
    expect(result?.state).toBe('started');
  });

  it('completeRunIfDelivered returns completed:false roadRunId:null when the order has no linked run', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const tn = tenancy(op);
      const [o] = await tx
        .insert(transportOrder)
        .values({ ...tn, state: 'draft' })
        .returning();
      if (!o) throw new Error('order seed failed');
      return completeRunIfDelivered(tx as never, op, o.transportOrderId);
    });
    expect(result?.completed).toBe(false);
    expect(result?.roadRunId).toBeNull();
  });

  it('completeRunIfDelivered is a no-op when a delivered run is already terminal (guarded flip moves 0 rows)', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const tn = tenancy(op);
      const [v] = await tx
        .insert(vehicle)
        .values({ ...tn, plate: 'CO-DONE-01', active: true })
        .returning();
      if (!v) throw new Error('vehicle seed failed');
      const [rr] = await tx
        .insert(roadRun)
        .values({
          ...tn,
          state: 'completed',
          assignedOperatorId: '00000000-0000-0000-0000-000000031003',
          assignedAssetId: v.vehicleId,
          startedAt: new Date(),
          completedAt: new Date(),
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
      for (let i = 0; i < 2; i += 1) {
        const [st] = await tx
          .insert(stop)
          .values({
            ...tn,
            transportOrderId: o.transportOrderId,
            sequence: i + 1,
            stopType: i === 0 ? 'pickup' : 'delivery',
          })
          .returning();
        if (!st) throw new Error('stop seed failed');
        await tx.insert(manifest).values({
          ...tn,
          transportOrderId: o.transportOrderId,
          stopId: st.stopId,
          manifestCorrelationId: crypto.randomUUID(),
          state: 'committed',
          committedAt: new Date(),
        });
      }
      return completeRunIfDelivered(tx as never, op, o.transportOrderId);
    });
    expect(result?.completed).toBe(false);
    expect(result?.roadRunId).not.toBeNull();
  });
});
