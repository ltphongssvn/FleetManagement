// apps/api/test/transport-orders.cancel.service.idempotent-heal.integration.test.ts
// L5 RED revealed by L0 Playwright: idempotent cancel must heal any
// road_run still in a non-cancelled state.
//
// Scenario: between the transport_order UPDATE and the road_run cascade
// UPDATE, the process crashes (or a pre-cascade build cancelled the
// transport_order but not the road_run). A retry from the dispatcher
// gets the idempotent path because transport_order.state === 'cancelled'
// already. Without healing, the road_run stays 'planned' forever and
// the dispatcher review view never reflects the cancellation.
//
// Rule under test: every cancel call ensures all linked road_runs are
// in 'cancelled' state, even on the idempotent path.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { TransportOrdersCancelService } from '../src/transport-orders/transport-orders.cancel.service.js';
import { roadRun, roadRunTransportOrder } from '../src/database/schema/transport.js';
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
    .values({ ...tn, fullName: 'HealDriver', operatorId: op.operatorId })
    .returning({ driverId: driver.driverId });
  const [v] = await tx
    .insert(vehicle)
    .values({ ...tn, plate: 'HEAL-' + randomUUID().slice(0, 4) })
    .returning({ vehicleId: vehicle.vehicleId });
  if (d === undefined || v === undefined) throw new Error('seed failed');
  await tx
    .insert(driverVehicleAssignment)
    .values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  return { operatorId: op.operatorId, vehicleId: v.vehicleId };
}
describe('@fleet/api - TransportOrdersCancelService idempotent heals stale road_runs', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });
  it('on idempotent re-cancel, ensures linked road_runs are also cancelled even if a prior partial cancel left them stale', async () => {
    let roadRunStateBeforeHeal: string | undefined;
    let roadRunStateAfterHeal: string | undefined;
    let resultIdempotent: boolean | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const createSvc = new TransportOrdersService(tx as never);
      const cancelSvc = new TransportOrdersCancelService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await createSvc.create(
        {
          externalRef: 'TO-HEAL-1',
          stops: [{ sequence: 1, stopType: 'pickup' }],
          roadRun: {
            plannedStartAt: '2026-05-10T07:00:00.000Z',
            assignedOperatorId: operatorId,
            assignedAssetId: vehicleId,
          },
        },
        op,
      );
      // Cancel once normally.
      await cancelSvc.cancel(created.transportOrderId, { reason: 'customer_request' }, op);
      // Simulate the partial-cancel scenario: a separate writer (or a
      // crash mid-cascade) reverts the road_run back to 'planned'. This
      // mirrors the production leftover that the L0 spec hit.
      await tx.update(roadRun).set({ state: 'planned' }).where(eq(roadRun.companyId, op.companyId));
      const [before] = await tx
        .select({ state: roadRun.state })
        .from(roadRun)
        .innerJoin(roadRunTransportOrder, eq(roadRunTransportOrder.roadRunId, roadRun.roadRunId))
        .where(
          and(
            eq(roadRunTransportOrder.transportOrderId, created.transportOrderId),
            eq(roadRun.companyId, op.companyId),
          ),
        )
        .limit(1);
      roadRunStateBeforeHeal = before?.state;
      // Idempotent re-cancel must heal the road_run.
      const r = await cancelSvc.cancel(
        created.transportOrderId,
        { reason: 'customer_request' },
        op,
      );
      resultIdempotent = r.idempotent;
      const [after] = await tx
        .select({ state: roadRun.state })
        .from(roadRun)
        .innerJoin(roadRunTransportOrder, eq(roadRunTransportOrder.roadRunId, roadRun.roadRunId))
        .where(
          and(
            eq(roadRunTransportOrder.transportOrderId, created.transportOrderId),
            eq(roadRun.companyId, op.companyId),
          ),
        )
        .limit(1);
      roadRunStateAfterHeal = after?.state;
    });
    expect(roadRunStateBeforeHeal).toBe('planned');
    expect(resultIdempotent).toBe(true);
    expect(roadRunStateAfterHeal).toBe('cancelled');
  });
});
