// apps/api/test/completion-reconciler-scheduled.acid.integration.test.ts
// ACID / RED-first (T32 scheduled-completion-reconciler arc). Attacks the
// structural gap proven from git history + scheduler + repo reads: the
// completion edge-trigger (#365) heals ONLY when the final manifest commits
// through finalizeIntake in-tx; the batch reconciler (L3) is MANUAL-only.
// A run reaching all-committed via a bypass path (manual intake:redrive,
// pre-deploy commit, edge-eval rollback) strands started (Dang chay) with
// Kho giao hang photos, and nothing scheduled heals it.
//
// ROOT-FIX contract (2026 multi-tenant boundary discipline, verified via
// live web search): a background reconciler must NOT collapse all tenants
// into one FLEET_PILOT_SCOPE -- that silently strands every non-pilot
// tenant (the same bug, reintroduced the moment a 2nd company exists). The
// scheduled tick discovers the distinct tenant scopes FROM THE DATA and
// reconciles each under its own company scope with a synthetic system
// operator id. The decisive acid assertion below seeds TWO companies both
// stranded and requires BOTH to heal -- this fails on a single-scope design
// and passes only on the tenant-iterating root fix.
//
// RED today: CompletionReconcilerService + DrizzleCompletionReconcileRepo do
// not exist, so this file fails to import -- the valid RED before GREEN.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { CompletionReconcilerService } from '../src/manifest/completion-reconciler.service.js';
import { DrizzleCompletionReconcileRepo } from '../src/manifest/completion-reconcile.repo.js';
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

// Synthetic system operator the scheduled reconciler attributes events to
// (mirrors the repair-scripts convention: a recognizable id in the audit
// trail). The service builds this internally; the test asserts on state +
// event presence, not on the id, so it is not needed as an input here.
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

// Seed a STARTED run whose order is FULLY delivered (every stop committed
// manifest + committed upload session) WITHOUT calling finalizeIntake --
// the run reached all-committed via a bypass path, so the edge-trigger
// never fired and it is still started. The exact production strand: Kho
// giao hang photos present, order stuck Dang chay.
async function seedStrandedDeliveredRun(
  tx: TestTx,
  op: ReturnType<typeof createOperatorContext>,
  plate: string,
  stopCount: number,
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
      state: 'started',
      assignedOperatorId: op.operatorId,
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
    const [m] = await tx
      .insert(manifest)
      .values({
        ...tn,
        transportOrderId: o.transportOrderId,
        stopId: s.stopId,
        manifestCorrelationId: crypto.randomUUID(),
        state: 'committed',
        committedAt: new Date(),
      })
      .returning();
    if (!m) throw new Error('manifest seed failed');
    const [us] = await tx
      .insert(uploadSession)
      .values({
        ...tn,
        manifestId: m.manifestId,
        operatorId: op.operatorId,
        s3Key: 'k/' + s.stopId,
        s3Bucket: 'b',
        contentType: 'image/jpeg',
        state: 'committed',
        committedAt: new Date(),
      })
      .returning();
    if (!us) throw new Error('upload_session seed failed');
  }
  return rr.roadRunId;
}

async function runState(tx: TestTx, roadRunId: string): Promise<string | undefined> {
  const [row] = await tx
    .select({ state: roadRun.state })
    .from(roadRun)
    .where(eq(roadRun.roadRunId, roadRunId));
  return row?.state;
}

describe('@fleet/api - scheduled completion reconciler heals edge-bypassed strands across tenants (ACID)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });

  it('reconcileOnce heals stranded delivered runs in TWO distinct companies (no single-scope treadmill)', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const opA = createOperatorContext();
      const opB = createOperatorContext();
      const runA = await seedStrandedDeliveredRun(tx, opA, 'CO-A-01', 2);
      const runB = await seedStrandedDeliveredRun(tx, opB, 'CO-B-01', 2);
      const repo = new DrizzleCompletionReconcileRepo(tx as never);
      const svc = new CompletionReconcilerService(repo, 0, 50);
      const outcome = await svc.reconcileOnce();
      return {
        afterA: await runState(tx, runA),
        afterB: await runState(tx, runB),
        outcome,
        companyA: opA.companyId,
        companyB: opB.companyId,
        runA,
        runB,
      };
    });
    expect(result?.afterA).toBe('completed');
    expect(result?.afterB).toBe('completed');
    expect(result?.outcome.repaired).toBe(2);
  });

  it('reconcileOnce is idempotent: a second pass repairs 0 and appends exactly one event per run', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const run = await seedStrandedDeliveredRun(tx, op, 'CO-IDEM-01', 2);
      const repo = new DrizzleCompletionReconcileRepo(tx as never);
      const svc = new CompletionReconcilerService(repo, 0, 50);
      const first = await svc.reconcileOnce();
      const second = await svc.reconcileOnce();
      const events = await tx
        .select({ aggregateId: syncChangeFeed.aggregateId })
        .from(syncChangeFeed)
        .where(
          and(
            eq(syncChangeFeed.companyId, op.companyId),
            eq(syncChangeFeed.aggregateType, 'road_run'),
            eq(syncChangeFeed.aggregateId, run),
          ),
        );
      return { first: first.repaired, second: second.repaired, eventCount: events.length };
    });
    expect(result?.first).toBe(1);
    expect(result?.second).toBe(0);
    expect(result?.eventCount).toBe(1);
  });

  it('reconcileOnce leaves a NOT-fully-delivered run started (predicate parity, no false heal)', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const tn = tenancy(op);
      const [v] = await tx
        .insert(vehicle)
        .values({ ...tn, plate: 'CO-PARTIAL-01', active: true })
        .returning();
      if (!v) throw new Error('vehicle seed failed');
      const [rr] = await tx
        .insert(roadRun)
        .values({
          ...tn,
          state: 'started',
          assignedOperatorId: op.operatorId,
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
      for (let i = 0; i < 2; i += 1) {
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
          state: i === 0 ? 'committed' : 'verifying',
          committedAt: i === 0 ? new Date() : null,
        });
      }
      const repo = new DrizzleCompletionReconcileRepo(tx as never);
      const svc = new CompletionReconcilerService(repo, 0, 50);
      const outcome = await svc.reconcileOnce();
      return { after: await runState(tx, rr.roadRunId), repaired: outcome.repaired };
    });
    expect(result?.after).toBe('started');
    expect(result?.repaired).toBe(0);
  });

  it('reconcileOnce finds no stranded tenants when nothing is fully delivered (empty-path branches)', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const tn = tenancy(op);
      const [v] = await tx
        .insert(vehicle)
        .values({ ...tn, plate: 'CO-NONE-01', active: true })
        .returning();
      if (!v) throw new Error('vehicle seed failed');
      const [rr] = await tx
        .insert(roadRun)
        .values({
          ...tn,
          state: 'started',
          assignedOperatorId: op.operatorId,
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
      // Two stops, only ONE committed manifest -> NOT fully delivered -> the
      // tenant is not stranded, so findStrandedTenants returns empty and
      // reconcileOnce never calls repairTenant. Exercises both empty branches.
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
        if (i === 0) {
          await tx.insert(manifest).values({
            ...tn,
            transportOrderId: o.transportOrderId,
            stopId: st.stopId,
            manifestCorrelationId: crypto.randomUUID(),
            state: 'committed',
            committedAt: new Date(),
          });
        }
      }
      const repo = new DrizzleCompletionReconcileRepo(tx as never);
      const svc = new CompletionReconcilerService(repo, 0, 50);
      const outcome = await svc.reconcileOnce();
      return { after: await runState(tx, rr.roadRunId), outcome };
    });
    expect(result?.after).toBe('started');
    expect(result?.outcome.tenants).toBe(0);
    expect(result?.outcome.repaired).toBe(0);
  });

  it('findStrandedTenants respects the batch limit: with 2 stranded tenants and batchSize 1, only one is repaired (limit break)', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const opA = createOperatorContext();
      const opB = createOperatorContext();
      const runA = await seedStrandedDeliveredRun(tx, opA, 'CO-LIM-A', 2);
      const runB = await seedStrandedDeliveredRun(tx, opB, 'CO-LIM-B', 2);
      const repo = new DrizzleCompletionReconcileRepo(tx as never);
      const svc = new CompletionReconcilerService(repo, 0, 1);
      const outcome = await svc.reconcileOnce();
      const healed = [await runState(tx, runA), await runState(tx, runB)].filter(
        (st) => st === 'completed',
      ).length;
      return { tenants: outcome.tenants, repaired: outcome.repaired, healed };
    });
    expect(result?.tenants).toBe(1);
    expect(result?.repaired).toBe(1);
    expect(result?.healed).toBe(1);
  });

  it('repairTenant returns 0 when a directly-targeted tenant has no delivered runs (TOCTOU empty guard)', async () => {
    const result = await withTxIsolation(testDb, async (tx) => {
      const op = createOperatorContext();
      const tn = tenancy(op);
      const [v] = await tx
        .insert(vehicle)
        .values({ ...tn, plate: 'CO-TOCTOU-01', active: true })
        .returning();
      if (!v) throw new Error('vehicle seed failed');
      const [rr] = await tx
        .insert(roadRun)
        .values({
          ...tn,
          state: 'started',
          assignedOperatorId: op.operatorId,
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
      // One delivery stop, NO committed manifest -> not delivered. Calling
      // repairTenant directly reaches the in-tx findDeliveredIncompleteRuns
      // empty result and the ids.length === 0 guard (return 0).
      const [st] = await tx
        .insert(stop)
        .values({
          ...tn,
          transportOrderId: o.transportOrderId,
          sequence: 1,
          stopType: 'delivery',
        })
        .returning();
      if (!st) throw new Error('stop seed failed');
      const repo = new DrizzleCompletionReconcileRepo(tx as never);
      const repaired = await repo.repairTenant(
        op.companyId,
        '00000000-0000-0000-0000-0000000000bb',
        50,
      );
      return { repaired, after: await runState(tx, rr.roadRunId) };
    });
    expect(result?.repaired).toBe(0);
    expect(result?.after).toBe('started');
  });
});
