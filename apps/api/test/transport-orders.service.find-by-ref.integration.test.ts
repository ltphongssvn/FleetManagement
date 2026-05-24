// apps/api/test/transport-orders.service.find-by-ref.integration.test.ts
// L5 RED for T5: TransportOrdersService.findByCompanyIdOrRef accepts
// either a UUID or the human-readable XT.NNN external_ref and returns
// the matching row scoped to the dispatcher's company (single-company
// deployment per Frozen Stack — no multi-tenant). Used by the review
// page resolver so the dispatcher can navigate to any order in the
// company, not just their own driver-assigned ones.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { TransportOrderNotFoundError } from '../src/transport-orders/transport-orders.errors.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
async function seedActivePair(tx: TestTx, op: ReturnType<typeof createOperatorContext>): Promise<{ operatorId: string; vehicleId: string }> {
  const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
  const [d] = await tx.insert(driver).values({ ...tn, fullName: 'CompanyScopedDriver', operatorId: op.operatorId }).returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'CSL-' + randomUUID().slice(0, 4) }).returning({ vehicleId: vehicle.vehicleId });
  if (d === undefined || v === undefined) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  return { operatorId: op.operatorId, vehicleId: v.vehicleId };
}
describe('@fleet/api - TransportOrdersService.findByCompanyIdOrRef (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('resolves a UUID input to the matching row in the same company', async () => {
    let createdId: string | undefined;
    let foundId: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await svc.create({
        externalRef: 'TO-IGNORED', // auto-numbered server-side
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-05-01T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      createdId = created.transportOrderId;
      const found = await svc.findByCompanyIdOrRef(created.transportOrderId, op);
      foundId = found.transportOrderId;
    });
    expect(foundId).toBe(createdId);
  });
  it('resolves an XT.NNN external_ref input to the matching row in the same company', async () => {
    let createdId: string | undefined;
    let assignedRef: string | undefined;
    let foundId: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-05-02T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      createdId = created.transportOrderId;
      assignedRef = created.externalRef;
      const found = await svc.findByCompanyIdOrRef(created.externalRef, op);
      foundId = found.transportOrderId;
    });
    expect(assignedRef).toBeTruthy();
    expect(foundId).toBe(createdId);
  });
  it('resolves an order even when the caller is not the driver assigned to its road_run (company-scoped, not operator-scoped)', async () => {
    let creatorId: string | undefined;
    let foundId: string | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const creator = createOperatorContext();
      // Another caller in the SAME company. companyId matches, operatorId differs.
      const otherCallerInSameCompany = createOperatorContext({ companyId: creator.companyId, businessUnitId: creator.businessUnitId, depotId: creator.depotId, legalEntityId: creator.legalEntityId });
      const { operatorId, vehicleId } = await seedActivePair(tx, creator);
      const created = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-05-03T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, creator);
      creatorId = created.transportOrderId;
      // Different operator in same company looks up by the externalRef.
      const found = await svc.findByCompanyIdOrRef(created.externalRef, otherCallerInSameCompany);
      foundId = found.transportOrderId;
    });
    expect(foundId).toBe(creatorId);
  });
  it('throws TransportOrderNotFoundError when no row matches the ref/id', async () => {
    let thrown: unknown;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      try {
        await svc.findByCompanyIdOrRef('XT.DOES-NOT-EXIST', op);
      } catch (e) {
        thrown = e;
      }
    });
    expect(thrown).toBeInstanceOf(TransportOrderNotFoundError);
  });
});
