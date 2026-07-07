// apps/api/test/transport-orders.service.driver-vehicle-pair.integration.test.ts
// RED → GREEN: TransportOrdersService.create must reject road_run submissions
// unless there is an active driver_vehicle_assignment row in the calling
// company that pairs the assignedOperatorId's driver with the supplied
// assignedAssetId (vehicle). This is the deepest defense layer: even if
// the client form, server action, and DTO all pass, the service refuses to
// persist an order whose driver-vehicle pair is not officially assigned.
//
// Assertions use the typed DriverVehicleAssignmentRequiredError class — not
// a regex on the message — so an unrelated DB or runtime error cannot
// produce a false-positive green.
//
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts). Seed
// helpers take the test tx as their first argument so every read and write
// in a given test happens inside the same transaction; the SUT is built
// with that same tx so its inner this.db.transaction(...) lands as a
// SAVEPOINT under us; the outer tx rolls back at the end. No TRUNCATE.
//
// Seed helpers are intentionally narrow: each test arranges only the rows
// it needs. We deliberately avoid a factory-with-overrides indirection at
// this scale (3 call sites) to keep arrange code obvious at the call site.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { TransportOrdersService } from '../src/transport-orders/transport-orders.service.js';
import { DriverVehicleAssignmentRequiredError } from '../src/transport-orders/transport-orders.errors.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation, type TestTx } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
const OP = createOperatorContext();
function tenancyOf(op = OP): {
  companyId: string; businessUnitId: string; depotId: string; legalEntityId: string;
} {
  return {
    companyId: op.companyId,
    businessUnitId: op.businessUnitId,
    depotId: op.depotId,
    legalEntityId: op.legalEntityId,
  };
}
async function seedActivePair(tx: TestTx): Promise<{ operatorId: string; vehicleId: string }> {
  const operatorId = randomUUID();
  const tn = tenancyOf();
  const [d] = await tx.insert(driver)
    .values({ ...tn, fullName: 'PAIRED', operatorId })
    .returning({ driverId: driver.driverId });
  const [v] = await tx.insert(vehicle)
    .values({ ...tn, plate: 'PAIR-001' })
    .returning({ vehicleId: vehicle.vehicleId });
  if (!d || !v) throw new Error('seed failed');
  await tx.insert(driverVehicleAssignment)
    .values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
  return { operatorId, vehicleId: v.vehicleId };
}
async function seedActivePairAndUnpairedVehicle(tx: TestTx): Promise<{
  operatorId: string; vehicleId: string; otherVehicleId: string;
}> {
  const base = await seedActivePair(tx);
  const tn = tenancyOf();
  const [v2] = await tx.insert(vehicle)
    .values({ ...tn, plate: 'PAIR-002' })
    .returning({ vehicleId: vehicle.vehicleId });
  if (!v2) throw new Error('seed failed');
  return { ...base, otherVehicleId: v2.vehicleId };
}
describe('@fleet/api - TransportOrdersService driver-vehicle pair guard', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('accepts roadRun whose operator+asset pair has an active assignment', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const { operatorId, vehicleId } = await seedActivePair(tx);
      const result = await svc.create({
        externalRef: 'TO-PAIR-OK',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: {
          plannedStartAt: '2026-04-30T08:00:00.000Z',
          assignedOperatorId: operatorId,
          assignedAssetId: vehicleId,
        },
      }, OP);
      expect(result.roadRunId).toMatch(/^[0-9a-f-]{36}$/i);
    });
  });
  it('rejects roadRun whose operator has no active assignment', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const unpairedOperatorId = randomUUID();
      const tn = tenancyOf();
      const [v] = await tx.insert(vehicle)
        .values({ ...tn, plate: 'ORPHAN' })
        .returning({ vehicleId: vehicle.vehicleId });
      if (!v) throw new Error('seed failed');
      await expect(svc.create({
        externalRef: 'TO-PAIR-MISS-OP',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: {
          plannedStartAt: '2026-04-30T08:00:00.000Z',
          assignedOperatorId: unpairedOperatorId,
          assignedAssetId: v.vehicleId,
        },
      }, OP)).rejects.toThrow(DriverVehicleAssignmentRequiredError);
    });
  });
  it('rejects roadRun whose operator is paired with a DIFFERENT vehicle', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const { operatorId, otherVehicleId } = await seedActivePairAndUnpairedVehicle(tx);
      await expect(svc.create({
        externalRef: 'TO-PAIR-MISMATCH',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: {
          plannedStartAt: '2026-04-30T08:00:00.000Z',
          assignedOperatorId: operatorId,
          assignedAssetId: otherVehicleId,
        },
      }, OP)).rejects.toThrow(DriverVehicleAssignmentRequiredError);
    });
  });
  it('rejects roadRun whose only assignment row has been revoked', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const { operatorId, vehicleId } = await seedActivePair(tx);
      await tx
        .update(driverVehicleAssignment)
        .set({ revokedAt: new Date(), revocationReason: 'test' })
        .where(eq(driverVehicleAssignment.companyId, OP.companyId));
      await expect(svc.create({
        externalRef: 'TO-PAIR-REVOKED',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: {
          plannedStartAt: '2026-04-30T08:00:00.000Z',
          assignedOperatorId: operatorId,
          assignedAssetId: vehicleId,
        },
      }, OP)).rejects.toThrow(DriverVehicleAssignmentRequiredError);
    });
  });
  it('rejects roadRun when the active assignment lives in a DIFFERENT company', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new TransportOrdersService(tx as never);
      const otherOp = createOperatorContext();
      const operatorId = randomUUID();
      const tn = tenancyOf(otherOp);
      const [d] = await tx.insert(driver)
        .values({ ...tn, fullName: 'OTHER CO', operatorId })
        .returning({ driverId: driver.driverId });
      const [v] = await tx.insert(vehicle)
        .values({ ...tn, plate: 'OTHER-CO-001' })
        .returning({ vehicleId: vehicle.vehicleId });
      if (!d || !v) throw new Error('seed failed');
      await tx.insert(driverVehicleAssignment)
        .values({ ...tn, driverId: d.driverId, vehicleId: v.vehicleId });
      await expect(svc.create({
        externalRef: 'TO-PAIR-TENANT',
        stops: [{ sequence: 1, stopType: 'pickup' }],
        roadRun: {
          plannedStartAt: '2026-04-30T08:00:00.000Z',
          assignedOperatorId: operatorId,
          assignedAssetId: v.vehicleId,
        },
      }, OP)).rejects.toThrow(DriverVehicleAssignmentRequiredError);
    });
  });
});
