// apps/api/test/transport-orders.service.find-by-ref.integration.test.ts
// L5 RED for T5: TransportOrdersService.findByCompanyIdOrRef accepts
// either a UUID or the human-readable XTT.MM-NNN external_ref and returns
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
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
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
  it('resolves an XTT.MM-NNN external_ref input to the matching row in the same company', async () => {
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
  it('enriches pickup/delivery warehouse names and timestamp fields when the order has stops with warehouses and a populated road_run', async () => {
    let pickupName: string | null | undefined;
    let deliveryName: string | null | undefined;
    let plannedStartAt: string | null | undefined;
    let startedAt: string | null | undefined;
    let completedAt: string | null | undefined;
    let stopsLen: number | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      // Seed two warehouses (pickup and delivery) and bind them to the
      // stops so the warehouseName join populates.
      const { warehouse } = await import('../src/database/schema/reference.js');
      const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
      const [wp] = await tx.insert(warehouse).values({ ...tn, name: 'PickupWH', role: 'pickup' }).returning({ warehouseId: warehouse.warehouseId });
      const [wd] = await tx.insert(warehouse).values({ ...tn, name: 'DeliveryWH', role: 'delivery' }).returning({ warehouseId: warehouse.warehouseId });
      if (wp === undefined || wd === undefined) throw new Error('warehouse seed failed');
      const created = await svc.create({
        stops: [
          { sequence: 1, stopType: 'pickup', yardId: wp.warehouseId, plannedAt: '2026-06-01T08:00:00.000Z' },
          { sequence: 2, stopType: 'delivery', yardId: wd.warehouseId, plannedAt: '2026-06-01T12:00:00.000Z' },
        ],
        roadRun: {
          plannedStartAt: '2026-06-01T07:00:00.000Z',
          assignedOperatorId: operatorId,
          assignedAssetId: vehicleId,
        },
      }, op);
      // create() does not expose startedAt/completedAt on roadRun (set
      // by the driver-side endpoints later). Set them directly so the
      // enrichment branches in findByCompanyIdOrRef are exercised.
      const { roadRun } = await import('../src/database/schema/transport.js');
      const { eq } = await import('drizzle-orm');
      await tx.update(roadRun)
        .set({
          startedAt: new Date('2026-06-01T07:15:00.000Z'),
          completedAt: new Date('2026-06-01T13:00:00.000Z'),
        })
        .where(eq(roadRun.companyId, op.companyId));
      const found = await svc.findByCompanyIdOrRef(created.transportOrderId, op);
      pickupName = found.pickupName;
      deliveryName = found.deliveryName;
      plannedStartAt = found.plannedStartAt;
      startedAt = found.startedAt;
      completedAt = found.completedAt;
      stopsLen = found.stops.length;
    });
    expect(pickupName).toBe('PickupWH');
    expect(deliveryName).toBe('DeliveryWH');
    expect(plannedStartAt).toBe('2026-06-01T07:00:00.000Z');
    expect(startedAt).toBe('2026-06-01T07:15:00.000Z');
    expect(completedAt).toBe('2026-06-01T13:00:00.000Z');
    expect(stopsLen).toBe(2);
  });
  it('falls back to null pickup/delivery names and null timestamps when stops have no warehouse and the road_run has no timestamps', async () => {
    let pickupName: string | null | undefined;
    let deliveryName: string | null | undefined;
    let plannedStartAt: string | null | undefined;
    let startedAt: string | null | undefined;
    let completedAt: string | null | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      // No warehouses on stops; only one pickup, no delivery.
      const created = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: {
          plannedStartAt: '2026-06-02T07:00:00.000Z',
          assignedOperatorId: operatorId,
          assignedAssetId: vehicleId,
        },
      }, op);
      // Force startedAt and completedAt back to NULL so the null
      // branches of the ternary in findByCompanyIdOrRef are exercised.
      const { roadRun } = await import('../src/database/schema/transport.js');
      const { eq } = await import('drizzle-orm');
      await tx.update(roadRun)
        .set({ startedAt: null, completedAt: null })
        .where(eq(roadRun.companyId, op.companyId));
      const found = await svc.findByCompanyIdOrRef(created.transportOrderId, op);
      pickupName = found.pickupName;
      deliveryName = found.deliveryName;
      plannedStartAt = found.plannedStartAt;
      startedAt = found.startedAt;
      completedAt = found.completedAt;
    });
    expect(pickupName).toBeNull();
    expect(deliveryName).toBeNull();
    // plannedStartAt is non-null here; assertion intentionally omitted.
    expect(plannedStartAt).not.toBeNull();
    expect(startedAt).toBeNull();
    expect(completedAt).toBeNull();
  });
  it('sets canCancel=false + cancelBlockedReason=photos_received when a received manifest exists', async () => {
    let canCancel: boolean | undefined;
    let reason: string | null | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-06-03T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      const { manifest } = await import('../src/database/schema/manifest.js');
      const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
      await tx.insert(manifest).values({ ...tn, transportOrderId: created.transportOrderId, manifestCorrelationId: randomUUID(), state: 'committed' });
      const found = await svc.findByCompanyIdOrRef(created.transportOrderId, op);
      canCancel = found.canCancel;
      reason = found.cancelBlockedReason;
    });
    expect(canCancel).toBe(false);
    expect(reason).toBe('photos_received');
  });
  it('sets canCancel=true + null reason when no received manifest exists', async () => {
    let canCancel: boolean | undefined;
    let reason: string | null | undefined;
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const created = await svc.create({
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { plannedStartAt: '2026-06-04T07:00:00.000Z', assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      const { manifest } = await import('../src/database/schema/manifest.js');
      const tn = { companyId: op.companyId, businessUnitId: op.businessUnitId, depotId: op.depotId, legalEntityId: op.legalEntityId };
      // A PENDING manifest (no photo yet) must NOT block cancel.
      await tx.insert(manifest).values({ ...tn, transportOrderId: created.transportOrderId, manifestCorrelationId: randomUUID(), state: 'pending' });
      const found = await svc.findByCompanyIdOrRef(created.transportOrderId, op);
      canCancel = found.canCancel;
      reason = found.cancelBlockedReason;
    });
    expect(canCancel).toBe(true);
    expect(reason).toBeNull();
  });
});
