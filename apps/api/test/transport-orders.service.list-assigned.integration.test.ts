// apps/api/test/transport-orders.service.list-assigned.integration.test.ts
// PGlite integration: exercises listAssigned() — assigned-row query,
// empty-result branch, stop grouping, row enrichment (plate, orderRef,
// customer + pickup/delivery warehouse names), tenancy isolation.
//
// 2026 invariant change: every order now carries a roadRun + active
// driver-vehicle pair. So 'plate' is always populated from the assigned
// vehicle. Only customer + pickup/delivery warehouse names remain nullable
// (when the order omits customerId or stops omit yardId). The nullable-
// enrichment test now asserts only customerName + pickup/deliveryName.
//
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { driver, vehicle, customer, warehouse } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
async function seedActivePair(tx: TestTx, op: ReturnType<typeof createOperatorContext>): Promise<{
  operatorId: string; vehicleId: string;
}> {
  const operatorId = op.operatorId;
  const tn = {
    companyId: op.companyId, businessUnitId: op.businessUnitId,
    depotId: op.depotId, legalEntityId: op.legalEntityId,
  };
  const [d] = await tx.insert(driver).values({ ...tn, fullName: 'LA', operatorId })
    .returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'LA-' + randomUUID().slice(0,4) })
    .returning({ vehicleId: vehicle.vehicleId });
  if (!d || !v) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({
    ...tn, driverId: d.driverId, vehicleId: v.vehicleId,
  });
  return { operatorId, vehicleId: v.vehicleId };
}
describe('@fleet/api - TransportOrdersService.listAssigned (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('returns empty rows when operator has no assigned road runs', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const result = await svc.listAssigned(op);
      expect(result.rows).toEqual([]);
    });
  });
  it('returns assigned road run with its stops grouped under the order', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      await svc.create({
        externalRef: 'TO-LA-1',
        stops: [
          { sequence: 1, stopType: 'pickup', plannedAt: '2026-05-01T08:00:00.000Z' },
          { sequence: 2, stopType: 'dropoff' },
        ],
        roadRun: {
          plannedStartAt: '2026-05-01T07:00:00.000Z',
          assignedOperatorId: operatorId,
          assignedAssetId: vehicleId,
        },
      }, op);
      const result = await svc.listAssigned(op);
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row?.externalRef).toMatch(/^XTT\.[0-9]{2}-[0-9]{3,}$/);
      expect(row?.state).toBe('planned');
      expect(row?.plannedStartAt).toBe('2026-05-01T07:00:00.000Z');
      expect(row?.startedAt).toBeNull();
      expect(row?.completedAt).toBeNull();
      expect(row?.stops).toHaveLength(2);
      expect(row?.stops[0]).toEqual({
        sequence: 1,
        stopType: 'pickup',
        plannedAt: '2026-05-01T08:00:00.000Z',
      });
      expect(row?.stops[1]).toEqual({
        sequence: 2,
        stopType: 'dropoff',
        plannedAt: null,
      });
    });
  });
  it('enriches rows with plate, orderRef, customerName, pickup/delivery names', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const vehicleId = '00000000-0000-0000-0000-0000000000a1';
      const customerId = '00000000-0000-0000-0000-0000000000b2';
      const pickupWhId = '00000000-0000-0000-0000-0000000000c3';
      const deliveryWhId = '00000000-0000-0000-0000-0000000000d4';
      const tn = {
        companyId: op.companyId,
        businessUnitId: op.businessUnitId,
        depotId: op.depotId,
        legalEntityId: op.legalEntityId,
      };
      await tx.insert(vehicle).values({ ...tn, vehicleId, plate: '62H-99999' });
      await tx.insert(customer).values({ ...tn, customerId, name: 'ACME Logistics' });
      await tx.insert(warehouse).values([
        { ...tn, warehouseId: pickupWhId, name: 'North Pickup Dock', role: 'pickup' },
        { ...tn, warehouseId: deliveryWhId, name: 'South Delivery Bay', role: 'delivery' },
      ]);
      const [dRow] = await tx.insert(driver)
        .values({ ...tn, fullName: 'ENRICH-DRIVER', operatorId: op.operatorId })
        .returning({ driverId: driver.driverId });
      if (!dRow) throw new Error('seed failed');
      await tx.insert(driverVehicleAssignment)
        .values({ ...tn, driverId: dRow.driverId, vehicleId });
      await svc.create({
        externalRef: 'TO-ENRICH-1',
        customerId,
        stops: [
          { sequence: 1, stopType: 'pickup', yardId: pickupWhId },
          { sequence: 2, stopType: 'delivery', yardId: deliveryWhId },
        ],
        roadRun: { assignedOperatorId: op.operatorId, assignedAssetId: vehicleId },
      }, op);
      const result = await svc.listAssigned(op);
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row?.orderRef).toMatch(/^XTT\.[0-9]{2}-[0-9]{3,}$/);
      expect(row?.plate).toBe('62H-99999');
      expect(row?.customerName).toBe('ACME Logistics');
      expect(row?.pickupName).toBe('North Pickup Dock');
      expect(row?.deliveryName).toBe('South Delivery Bay');
    });
  });
  it('enrichment fields are null when no customer or yardId is supplied', async () => {
    // After the 2026 invariant change, plate is always populated (vehicle is
    // mandatory). The remaining nullable enrichment branches are customer
    // (no customerId on the order) and pickup/delivery warehouse (no yardId
    // on the stops).
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      await svc.create({
        externalRef: 'TO-NULLS-1',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      const result = await svc.listAssigned(op);
      expect(result.rows).toHaveLength(1);
      const row = result.rows[0];
      expect(row?.customerName).toBeNull();
      expect(row?.pickupName).toBeNull();
      expect(row?.deliveryName).toBeNull();
    });
  });
  it('excludes road runs assigned to a different operator', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op1 = createOperatorContext({ companyId: '00000000-0000-0000-0000-000000000001' });
      const op2 = createOperatorContext({ companyId: '00000000-0000-0000-0000-000000000001' });
      const { operatorId, vehicleId } = await seedActivePair(tx, op1);
      await svc.create({
        externalRef: 'TO-OTHER-1',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op1);
      const result = await svc.listAssigned(op2);
      expect(result.rows).toEqual([]);
    });
  });
});
