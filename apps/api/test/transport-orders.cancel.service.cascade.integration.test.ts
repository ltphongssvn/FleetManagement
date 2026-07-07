// apps/api/test/transport-orders.cancel.service.cascade.integration.test.ts
// L5 RED: cascade rule revealed by the outside-in L0 Playwright failure.
//
// The dispatcher review view renders ListAssignedRow.state, which the
// existing listAssigned/findById queries source from road_run.state, NOT
// transport_order.state. Cancelling only the transport_order leaves the
// road_run in its previous state and the dispatcher never sees the
// 'cancelled' label.
//
// Business rule made explicit: cancelling a transport_order also cancels
// every road_run that fulfills it. Both rows transition to 'cancelled'
// atomically inside the same database transaction.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { TransportOrdersCancelService } from '../src/transport-orders/transport-orders.cancel.service.js';
import { transportOrder, roadRun, roadRunTransportOrder } from '../src/database/schema/transport.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
async function seedActivePair(tx: TestTx, op: ReturnType<typeof createOperatorContext>): Promise<{ operatorId: string; vehicleId: string }> {
  const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
  const [d] = await tx.insert(driver).values({ ...tn, fullName: 'CascadeDriver', operatorId: op.operatorId }).returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'CSC-' + randomUUID().slice(0, 4) }).returning({ vehicleId: vehicle.vehicleId });
  if (d === undefined || v === undefined) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  return { operatorId: op.operatorId, vehicleId: v.vehicleId };
}
describe('@fleet/api - TransportOrdersCancelService cascade to road_run', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('cascades cancellation to every road_run linked to the cancelled transport_order', async () => {
    let transportState: string | undefined;
    let roadRunState: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const createSvc = new TransportOrdersService(tx as never);
      const cancelSvc = new TransportOrdersCancelService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await createSvc.create({
        externalRef: 'TO-CSC-1',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-05-10T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      await cancelSvc.cancel(created.transportOrderId, { reason: 'customer_request' }, op);
      const [to] = await tx.select({ state: transportOrder.state }).from(transportOrder)
        .where(eq(transportOrder.transportOrderId, created.transportOrderId)).limit(1);
      const [rr] = await tx.select({ state: roadRun.state }).from(roadRun)
        .innerJoin(roadRunTransportOrder, eq(roadRunTransportOrder.roadRunId, roadRun.roadRunId))
        .where(eq(roadRunTransportOrder.transportOrderId, created.transportOrderId))
        .limit(1);
      transportState = to?.state;
      roadRunState = rr?.state;
    });
    expect(transportState).toBe('cancelled');
    expect(roadRunState).toBe('cancelled');
  });
});
