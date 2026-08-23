// apps/api/test/transport-orders.cancel.service.projection-event.integration.test.ts
// L5 RED for the L0 (e2e/dispatch-board-reflects-cancel.spec.ts): the
// cancel service must publish a sync_change_feed event for every road_run
// it cancels, so the dispatch_board projection runner can materialize the
// new state. Without this event, the projection row stays stale and the
// dispatcher's board lies about state long after the API has been
// cancelled.
//
// Invariant under test: after a successful cancel, sync_change_feed has
// at least one row for each cascaded road_run with delta.state='cancelled'
// AND aggregateType='road_run', so the projection runner's pure policy
// applyDispatchBoardEvent produces an upsert with state='cancelled'.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, and, gt } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { TransportOrdersCancelService } from '../src/transport-orders/transport-orders.cancel.service.js';
import { syncChangeFeed } from '../src/database/schema/index.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import {
  startPgliteTestDb,
  stopPgliteTestDb,
  type PgliteTestDb,
} from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
async function seedActivePair(
  tx: TestTx,
  op: ReturnType<typeof createOperatorContext>,
): Promise<{ operatorId: string; vehicleId: string }> {
  const tn = {
    companyId: op.companyId,
    businessUnitId: op.businessUnitId,
    depotId: op.depotId,
    legalEntityId: op.legalEntityId,
  };
  const [d] = await tx
    .insert(driver)
    .values({ ...tn, fullName: 'ProjectionEventDriver', operatorId: op.operatorId })
    .returning({ driverId: driver.driverId });
  const [v] = await tx
    .insert(vehicle)
    .values({ ...tn, plate: 'PE-' + randomUUID().slice(0, 4) })
    .returning({ vehicleId: vehicle.vehicleId });
  if (d === undefined || v === undefined) throw new Error('seed failed');
  await tx
    .insert(driverVehicleAssignment)
    .values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  return { operatorId: op.operatorId, vehicleId: v.vehicleId };
}
describe('@fleet/api - TransportOrdersCancelService publishes sync_change_feed event for projection', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });
  it('appends a road_run sync_change_feed event with delta.state=cancelled when a transport_order is cancelled', async () => {
    let createdRoadRunId: string | undefined;
    let cancellationEvents: readonly {
      aggregateType: string;
      aggregateId: string;
      delta: unknown;
    }[] = [];
    await withTxIsolation(testDb, async (tx) => {
      const createSvc = new TransportOrdersService(tx as never);
      const cancelSvc = new TransportOrdersCancelService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await createSvc.create(
        {
          stops: [{ sequence: 1, stopType: 'pickup' }],
          roadRun: {
            plannedStartAt: '2026-06-10T07:00:00.000Z',
            assignedOperatorId: operatorId,
            assignedAssetId: vehicleId,
          },
        },
        op,
      );
      createdRoadRunId = created.roadRunId;
      // Capture the highest serverSeq BEFORE cancel so we only inspect
      // the events the cancel call appends.
      const [{ serverSeq: maxBefore } = { serverSeq: 0n }] = await tx
        .select({ serverSeq: syncChangeFeed.serverSeq })
        .from(syncChangeFeed)
        .where(eq(syncChangeFeed.companyId, op.companyId))
        .orderBy(syncChangeFeed.serverSeq);
      const beforeSeq = typeof maxBefore === 'bigint' ? maxBefore : 0n;
      await cancelSvc.cancel(created.transportOrderId, { reason: 'customer_request' }, op);
      // Read every event the cancel call appended.
      const rows = await tx
        .select({
          aggregateType: syncChangeFeed.aggregateType,
          aggregateId: syncChangeFeed.aggregateId,
          delta: syncChangeFeed.delta,
        })
        .from(syncChangeFeed)
        .where(
          and(eq(syncChangeFeed.companyId, op.companyId), gt(syncChangeFeed.serverSeq, beforeSeq)),
        )
        .orderBy(syncChangeFeed.serverSeq);
      cancellationEvents = rows;
    });
    expect(createdRoadRunId).toBeTruthy();
    const roadRunEvents = cancellationEvents.filter(
      (e) => e.aggregateType === 'road_run' && e.aggregateId === createdRoadRunId,
    );
    expect(roadRunEvents.length).toBeGreaterThanOrEqual(1);
    const cancelledEvent = roadRunEvents.find((e) => {
      const d = e.delta as { state?: unknown };
      return d.state === 'cancelled';
    });
    expect(
      cancelledEvent,
      'expected a road_run event with delta.state=cancelled to be appended',
    ).toBeTruthy();
  });
});
