// apps/api/test/driver-delivery.complete-requires-manifests.integration.test.ts
// L4 RED for the 2026 permanent business rule (completion gate):
//   A road_run may transition started -> completed ONLY when every stop of
//   every transport_order in the run has a COMMITTED manifest (the driver
//   finished taking photos at all pickup + delivery warehouses). Missing any
//   photo => completion is REJECTED, so the driver/truck stay BUSY and remain
//   hidden from the dispatch dropdowns (the read-side guard trusts road_run
//   .state, so this transition guard keeps the state honest).
//
// 2026 best practice: state-machine guards read COMMITTED state, pure +
//   deterministic; the completion event flips state, not a manual override.
//   The guard counts committed manifests vs stop count for the runs orders.
//   We assert at the SERVICE boundary (DriverDeliveryService.complete) against
//   a real PGlite DB so the count query is genuinely exercised.
//
// Discriminating shape: seed a started road_run + 1 transport_order + 2 stops
// (pickup+delivery). Case A: 1 committed manifest (one photo missing) ->
// complete() REJECTS. Case B: 2 committed manifests (all photos) ->
// complete() SUCCEEDS, road_run 'completed'.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { roadRun, roadRunTransportOrder, transportOrder, stop } from '../src/database/schema/transport.js';
import { manifest } from '../src/database/schema/manifest.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
import { randomUUID } from 'node:crypto';
let testDb: PgliteTestDb;
type Op = ReturnType<typeof createOperatorContext>;
function tenancy(op: Op): {
  companyId: string; businessUnitId: string; depotId: string; legalEntityId: string;
} {
  return {
    companyId: op.companyId, businessUnitId: op.businessUnitId,
    depotId: op.depotId, legalEntityId: op.legalEntityId,
  };
}
// Seed a started road_run bound to op.operatorId, with one transport_order
// carrying stopCount stops and committedManifests committed manifests.
// tx is the PGlite drizzle transaction (typed via the same 'as never' bridge
// the other integration specs use); its .values()/.returning() are awaitable.
async function seedStartedRun(
  tx: never,
  op: Op,
  stopCount: number,
  committedManifests: number,
): Promise<string> {
  const t = tenancy(op);
  const db = tx as {
    insert: (table: unknown) => {
      values: (v: unknown) => Promise<void> & { returning: () => Promise<readonly Record<string, string>[]> };
    };
  };
  const [rr] = await db.insert(roadRun).values({
    ...t, state: 'started',
    assignedOperatorId: op.operatorId, assignedAssetId: randomUUID(),
    startedAt: new Date(),
  }).returning();
  const [to] = await db.insert(transportOrder).values({
    ...t, state: 'in_transit', externalRef: 'XTT.06-' + String(Date.now()).slice(-6),
  }).returning();
  if (rr === undefined || to === undefined) throw new Error('seed failed');
  const roadRunId = rr['roadRunId'];
  const transportOrderId = to['transportOrderId'];
  if (roadRunId === undefined || transportOrderId === undefined) throw new Error('seed missing ids');
  await db.insert(roadRunTransportOrder).values({
    ...t, roadRunId, transportOrderId, sequence: 1,
  });
  for (let i = 0; i < stopCount; i++) {
    await db.insert(stop).values({
      ...t, transportOrderId, sequence: i + 1,
      stopType: i === 0 ? 'pickup' : 'delivery',
    });
  }
  for (let i = 0; i < committedManifests; i++) {
    await db.insert(manifest).values({
      ...t, transportOrderId, manifestCorrelationId: randomUUID(),
      state: 'committed', capturedByOperatorId: op.operatorId, committedAt: new Date(),
    });
  }
  return roadRunId;
}
describe('@fleet/api - DriverDeliveryService.complete requires all manifests committed', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 30_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('REJECTS completion when a stop is missing its committed manifest (1 of 2 photos)', async () => {
    const outcome = await withTxIsolation(testDb, async (tx) => {
      const { DriverDeliveryService } = await import('../src/dispatch/driver-delivery.service.js');
      const op = createOperatorContext();
      const rrId = await seedStartedRun(tx as never, op, 2, 1);
      const svc = new DriverDeliveryService(tx as never);
      let rejected = false;
      let message = '';
      try {
        await svc.complete(rrId, op);
      } catch (e) {
        rejected = true;
        message = e instanceof Error ? e.message : String(e);
      }
      return { rejected, message };
    });
    expect(outcome?.rejected).toBe(true);
    expect(outcome?.message).toMatch(/manifest|photo|incomplete|not.*complete/i);
  });
  it('ALLOWS completion when every stop has a committed manifest (2 of 2 photos)', async () => {
    const outcome = await withTxIsolation(testDb, async (tx) => {
      const { DriverDeliveryService } = await import('../src/dispatch/driver-delivery.service.js');
      const op = createOperatorContext();
      const rrId = await seedStartedRun(tx as never, op, 2, 2);
      const svc = new DriverDeliveryService(tx as never);
      const res = await svc.complete(rrId, op);
      return { state: res.state };
    });
    expect(outcome?.state).toBe('completed');
  });
});
