// apps/api/test/transport-orders.trip-history.integration.test.ts
// PGlite integration: TransportOrdersService.tripHistory — completed road
// runs for the calling operator, grouped by Asia/Ho_Chi_Minh month via the
// shared @fleet/domain groupCompletedTripsByMonth helper. svc.create only
// produces planned runs, so completed runs are simulated by updating
// road_run.state + completed_at directly after creation.
//
// 2026 invariant: every order requires a roadRun + active driver-vehicle
// pair. Each test seeds the pair, then assigns multiple orders to the same
// operator via that pair.
//
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
// completeRoadRun takes tx so the post-create UPDATE happens inside the
// same transaction as the SUT call and is visible to subsequent reads.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { roadRun } from '../src/database/schema/transport.js';
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
  const [d] = await tx.insert(driver).values({ ...tn, fullName: 'TH', operatorId })
    .returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle).values({ ...tn, plate: 'TH-' + randomUUID().slice(0,4) })
    .returning({ vehicleId: vehicle.vehicleId });
  if (!d || !v) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment).values({
    ...tn, driverId: d.driverId, vehicleId: v.vehicleId,
  });
  return { operatorId, vehicleId: v.vehicleId };
}
async function completeRoadRun(tx: TestTx, operatorId: string, completedAtIso: string): Promise<void> {
  const rows = await tx
    .select({ id: roadRun.roadRunId })
    .from(roadRun)
    .where(eq(roadRun.assignedOperatorId, operatorId));
  const target = rows[rows.length - 1];
  if (!target) throw new Error('no road run to complete');
  await tx
    .update(roadRun)
    .set({ state: 'completed', completedAt: new Date(completedAtIso) })
    .where(eq(roadRun.roadRunId, target.id));
}
describe('@fleet/api - TransportOrdersService.tripHistory (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('returns no months when the operator has no completed runs', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      await svc.create({
        externalRef: 'TO-PLANNED',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      const result = await svc.tripHistory(op);
      expect(result.months).toEqual([]);
    });
  });
  it('groups completed runs by VN month, newest month first, with counts', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const rr = { assignedOperatorId: operatorId, assignedAssetId: vehicleId };
      await svc.create({ externalRef: 'TO-M1', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: rr }, op);
      await completeRoadRun(tx, op.operatorId, '2026-03-02T03:00:00.000Z');
      await svc.create({ externalRef: 'TO-M2', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: rr }, op);
      await completeRoadRun(tx, op.operatorId, '2026-03-25T03:00:00.000Z');
      await svc.create({ externalRef: 'TO-F1', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: rr }, op);
      await completeRoadRun(tx, op.operatorId, '2026-02-10T03:00:00.000Z');
      const result = await svc.tripHistory(op);
      expect(result.months).toHaveLength(2);
      expect(result.months[0]?.monthKey).toBe('2026-03');
      expect(result.months[0]?.count).toBe(2);
      expect(result.months[1]?.monthKey).toBe('2026-02');
      expect(result.months[1]?.count).toBe(1);
    });
  });
  it('each month carries trips with the listAssigned row shape (orderRef, completedAt)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const rr = { assignedOperatorId: operatorId, assignedAssetId: vehicleId };
      await svc.create({ externalRef: 'TO-SHAPE', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: rr }, op);
      await completeRoadRun(tx, op.operatorId, '2026-03-15T03:00:00.000Z');
      const result = await svc.tripHistory(op);
      const trip = result.months[0]?.trips[0];
      expect(trip?.orderRef).toBe('TO-SHAPE');
      expect(trip?.state).toBe('completed');
      expect(trip?.completedAt).toBe('2026-03-15T03:00:00.000Z');
    });
  });
  it('excludes planned runs even when other runs are completed', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      const rr = { assignedOperatorId: operatorId, assignedAssetId: vehicleId };
      await svc.create({ externalRef: 'TO-DONE', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: rr }, op);
      await completeRoadRun(tx, op.operatorId, '2026-03-05T03:00:00.000Z');
      await svc.create({ externalRef: 'TO-STILL-PLANNED', stops: [{ sequence: 1, stopType: 'pickup' }], roadRun: rr }, op);
      const result = await svc.tripHistory(op);
      const allRefs = result.months.flatMap((m) => m.trips.map((t) => t.orderRef));
      expect(allRefs).toEqual(['TO-DONE']);
    });
  });
  it('isolates trip history by operator', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op1 = createOperatorContext();
      const op2 = createOperatorContext();
      const a = await seedActivePair(tx, op1);
      await svc.create({
        externalRef: 'TO-OP1',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: a.operatorId, assignedAssetId: a.vehicleId },
      }, op1);
      await completeRoadRun(tx, op1.operatorId, '2026-03-12T03:00:00.000Z');
      const result = await svc.tripHistory(op2);
      expect(result.months).toEqual([]);
    });
  });
  it('buckets a late-night UTC completion into the VN next month', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const op = createOperatorContext();
      const { operatorId, vehicleId } = await seedActivePair(tx, op);
      await svc.create({
        externalRef: 'TO-TZ',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: { assignedOperatorId: operatorId, assignedAssetId: vehicleId },
      }, op);
      await completeRoadRun(tx, op.operatorId, '2026-02-28T18:30:00.000Z');
      const result = await svc.tripHistory(op);
      expect(result.months[0]?.monthKey).toBe('2026-03');
    });
  });
});
