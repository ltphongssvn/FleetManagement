// apps/api/test/reference.delete-cancels-open-orders.integration.test.ts
// L3 invariant (2026-Q2 defense-in-depth extension): when a vehicle or
// driver is soft-deleted, every non-terminal transport_order linked to
// it via road_run.assigned_asset_id / road_run.assigned_operator_id MUST
// also transition to state='cancelled' in the same transaction. Without
// this, E2E tests (or any caller) that soft-delete the endpoint leave
// orphan transport_order rows behind that pile up forever in the live
// dispatch board. Non-terminal = state NOT IN ('completed', 'cancelled');
// terminal orders are historical and stay untouched.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { ReferenceService } from '../src/reference/reference.service.js';
import { AdminDriversUpdateService } from '../src/admin/admin-drivers-update.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { transportOrder } from '../src/database/schema/transport.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
const OP = createOperatorContext();
function tenancy(): {
  companyId: string; businessUnitId: string; depotId: string; legalEntityId: string;
} {
  return {
    companyId: OP.companyId, businessUnitId: OP.businessUnitId,
    depotId: OP.depotId, legalEntityId: OP.legalEntityId,
  };
}
async function seedPairAndOrder(
  tx: TestTx, suffix: string,
): Promise<{ driverId: string; vehicleId: string; operatorId: string; transportOrderId: string }> {
  const tn = tenancy();
  const operatorId = randomUUID();
  const [d] = await tx.insert(driver).values({ ...tn, fullName: 'CASC-' + suffix, operatorId }).returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'CASC-' + suffix }).returning({ vehicleId: vehicle.vehicleId });
  if (!d || !v) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  const svc = new TransportOrdersService(tx as never);
  const created = await svc.create({
    stops: [{ sequence: 1, stopType: 'pickup' }],
    roadRun: { assignedOperatorId: operatorId, assignedAssetId: v.vehicleId },
  }, OP);
  return { driverId: d.driverId, vehicleId: v.vehicleId, operatorId, transportOrderId: created.transportOrderId };
}
describe('@fleet/api - soft-delete cascades cancellation onto non-terminal transport_orders', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('deleteVehicle() cancels open transport_orders linked through road_run.assigned_asset_id', async () => {
    const captured = await withTxIsolation(testDb, async (tx) => {
      const pair = await seedPairAndOrder(tx, 'V');
      const svc = new ReferenceService(tx as never);
      await svc.deleteVehicle(OP, pair.vehicleId);
      const [row] = await tx.select({ state: transportOrder.state })
        .from(transportOrder)
        .where(and(eq(transportOrder.companyId, OP.companyId), eq(transportOrder.transportOrderId, pair.transportOrderId)));
      return row?.state ?? null;
    });
    expect(captured).toBe('cancelled');
  });
  it('AdminDriversUpdateService.softDelete() cancels open transport_orders linked through road_run.assigned_operator_id', async () => {
    const captured = await withTxIsolation(testDb, async (tx) => {
      const pair = await seedPairAndOrder(tx, 'D');
      const svc = new AdminDriversUpdateService(tx as never);
      await svc.softDelete({ companyId: OP.companyId, driverId: pair.driverId });
      const [row] = await tx.select({ state: transportOrder.state })
        .from(transportOrder)
        .where(and(eq(transportOrder.companyId, OP.companyId), eq(transportOrder.transportOrderId, pair.transportOrderId)));
      return row?.state ?? null;
    });
    expect(captured).toBe('cancelled');
  });
});
