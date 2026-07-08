// apps/api/test/transport-orders.service.cargo-enrichment.integration.test.ts
// T7 L3+L4 RED → GREEN: the create() service persists cargoTypeId, and
// findByCompanyIdOrRef enriches the read with cargo name AND driver name
// AND order metadata (vehiclePlate fallback). The review view is the
// authoritative read of what was written; FK columns make this true at
// the projection level (industry 2026 CQRS norm).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { driver, vehicle, customer, cargoType } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
async function seedPair(tx: TestTx, op: ReturnType<typeof createOperatorContext>): Promise<{ operatorId: string; vehicleId: string; driverFullName: string }> {
  const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
  const driverFullName = 'CARGO-TEST DRIVER ' + randomUUID().slice(0, 6);
  const [d] = await tx.insert(driver).values({ ...tn, fullName: driverFullName, operatorId: op.operatorId }).returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'CT-' + randomUUID().slice(0, 4) }).returning({ vehicleId: vehicle.vehicleId });
  if (d === undefined || v === undefined) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  return { operatorId: op.operatorId, vehicleId: v.vehicleId, driverFullName };
}
describe('@fleet/api - cargo/customer/driver enrichment on review query (T7)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('persists cargoTypeId and returns cargoName on the review row', async () => {
    let cargoName: string | null | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedPair(tx, op);
      const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
      const [cg] = await tx.insert(cargoType).values({ ...tn, name: 'GẠO-T7' }).returning({ cargoTypeId: cargoType.cargoTypeId });
      if (cg === undefined) throw new Error('cargo seed failed');
      const created = await svc.create({
        cargoTypeId: cg.cargoTypeId,
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-06-01T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      const found = await svc.findByCompanyIdOrRef(created.transportOrderId, op);
      cargoName = (found as unknown as { cargoName: string | null }).cargoName;
    });
    expect(cargoName).toBe('GẠO-T7');
  });
  it('returns driverName on the review row joined from the assigned road_run operator', async () => {
    let driverName: string | null | undefined;
    let expectedFullName: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const seeded = await seedPair(tx, op);
      expectedFullName = seeded.driverFullName;
      const created = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-06-01T07:00:00.000Z', assignedOperatorId: seeded.operatorId, assignedAssetId: seeded.vehicleId },
      }, op);
      const found = await svc.findByCompanyIdOrRef(created.transportOrderId, op);
      driverName = (found as unknown as { driverName: string | null }).driverName;
    });
    expect(driverName).toBe(expectedFullName);
  });
  it('returns customerName on the review row when customerId is set', async () => {
    let customerName: string | null | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedPair(tx, op);
      const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
      const [c] = await tx.insert(customer).values({ ...tn, name: 'KH-T7' }).returning({ customerId: customer.customerId });
      if (c === undefined) throw new Error('customer seed failed');
      const created = await svc.create({
        customerId: c.customerId,
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-06-01T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      const found = await svc.findByCompanyIdOrRef(created.transportOrderId, op);
      customerName = found.customerName;
    });
    expect(customerName).toBe('KH-T7');
  });
});
