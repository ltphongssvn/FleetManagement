// apps/api/test/reference.hide-busy-driver-vehicle.integration.test.ts
// L4 RED for the 2026 permanent business rule:
//   A driver/vehicle bound to a road_run in a NON-TERMINAL state
//   (planned|dispatched|started) is BUSY and MUST be excluded from
//   ReferenceService.drivers(op) and .vehicles(op) (the dispatch form
//   dropdowns Tài xế / Số xe). Only when the road_run reaches a TERMINAL
//   state (completed|cancelled) does the pair become selectable again.
//
// Discriminating shape (mirrors reference.paired-only): each test seeds
// BOTH an idle paired pair (must REMAIN) and a busy paired pair (bound to
// a non-terminal road_run, must be EXCLUDED) in the same transaction, then
// captures the service result OUTSIDE withTxIsolation (the helper swallows
// in-body assertion errors as part of rollback signaling).
//
// Terminal-state re-appearance is covered by a dedicated case: a pair whose
// only road_run is 'completed' MUST remain selectable.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ReferenceService } from '../src/reference/reference.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import { roadRun } from '../src/database/schema/transport.js';
import { startPgliteTestDb, stopPgliteTestDb, type PgliteTestDb } from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
function tenancy(op: ReturnType<typeof createOperatorContext>): {
  companyId: string; businessUnitId: string; depotId: string; legalEntityId: string;
} {
  return {
    companyId: op.companyId, businessUnitId: op.businessUnitId,
    depotId: op.depotId, legalEntityId: op.legalEntityId,
  };
}
describe('@fleet/api - ReferenceService hides busy (incomplete road_run) driver+vehicle', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); }, 60_000);
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  describe('drivers(op)', () => {
    it('excludes a driver bound to a started road_run while keeping an idle paired driver', async () => {
      const result = await withTxIsolation(testDb, async (tx) => {
        const svc = new ReferenceService(tx as never);
        const op = createOperatorContext();
        const opIdle = '00000000-0000-0000-0000-000000003001';
        const opBusy = '00000000-0000-0000-0000-000000003002';
        const [drvIdle] = await tx.insert(driver).values({
          ...tenancy(op), fullName: 'AAA IdleDrv', active: true, operatorId: opIdle,
        }).returning();
        const [drvBusy] = await tx.insert(driver).values({
          ...tenancy(op), fullName: 'BBB BusyDrv', active: true, operatorId: opBusy,
        }).returning();
        const [vehIdle] = await tx.insert(vehicle).values({
          ...tenancy(op), plate: 'IDLE-01', active: true,
        }).returning();
        const [vehBusy] = await tx.insert(vehicle).values({
          ...tenancy(op), plate: 'BUSY-01', active: true,
        }).returning();
        if (!drvIdle || !drvBusy || !vehIdle || !vehBusy) throw new Error('seed failed');
        await tx.insert(driverVehicleAssignment).values([
          { ...tenancy(op), driverId: drvIdle.driverId, vehicleId: vehIdle.vehicleId },
          { ...tenancy(op), driverId: drvBusy.driverId, vehicleId: vehBusy.vehicleId },
        ]);
        // Busy pair: a started (non-terminal) road_run binds opBusy + vehBusy.
        await tx.insert(roadRun).values({
          ...tenancy(op), state: 'started',
          assignedOperatorId: opBusy, assignedAssetId: vehBusy.vehicleId,
          startedAt: new Date(),
        });
        return (await svc.drivers(op)).items;
      });
      expect(result).toEqual([{ id: '00000000-0000-0000-0000-000000003001', label: 'AAA IdleDrv' }]);
    });
    it('keeps a driver whose only road_run is completed (terminal -> free again)', async () => {
      const result = await withTxIsolation(testDb, async (tx) => {
        const svc = new ReferenceService(tx as never);
        const op = createOperatorContext();
        const opDone = '00000000-0000-0000-0000-000000003010';
        const [drvDone] = await tx.insert(driver).values({
          ...tenancy(op), fullName: 'AAA DoneDrv', active: true, operatorId: opDone,
        }).returning();
        const [vehDone] = await tx.insert(vehicle).values({
          ...tenancy(op), plate: 'DONE-01', active: true,
        }).returning();
        if (!drvDone || !vehDone) throw new Error('seed failed');
        await tx.insert(driverVehicleAssignment).values({
          ...tenancy(op), driverId: drvDone.driverId, vehicleId: vehDone.vehicleId,
        });
        await tx.insert(roadRun).values({
          ...tenancy(op), state: 'completed',
          assignedOperatorId: opDone, assignedAssetId: vehDone.vehicleId,
          startedAt: new Date(), completedAt: new Date(),
        });
        return (await svc.drivers(op)).items;
      });
      expect(result).toEqual([{ id: '00000000-0000-0000-0000-000000003010', label: 'AAA DoneDrv' }]);
    });
  });
  describe('vehicles(op)', () => {
    it('excludes a vehicle bound to a started road_run while keeping an idle paired vehicle', async () => {
      const captured = await withTxIsolation(testDb, async (tx) => {
        const svc = new ReferenceService(tx as never);
        const op = createOperatorContext();
        const opIdle = '00000000-0000-0000-0000-000000004001';
        const opBusy = '00000000-0000-0000-0000-000000004002';
        const [drvIdle] = await tx.insert(driver).values({
          ...tenancy(op), fullName: 'VIdleDrv', active: true, operatorId: opIdle,
        }).returning();
        const [drvBusy] = await tx.insert(driver).values({
          ...tenancy(op), fullName: 'VBusyDrv', active: true, operatorId: opBusy,
        }).returning();
        const [vehIdle] = await tx.insert(vehicle).values({
          ...tenancy(op), plate: 'AAA-VIDLE-01', active: true,
        }).returning();
        const [vehBusy] = await tx.insert(vehicle).values({
          ...tenancy(op), plate: 'BBB-VBUSY-01', active: true,
        }).returning();
        if (!drvIdle || !drvBusy || !vehIdle || !vehBusy) throw new Error('seed failed');
        await tx.insert(driverVehicleAssignment).values([
          { ...tenancy(op), driverId: drvIdle.driverId, vehicleId: vehIdle.vehicleId },
          { ...tenancy(op), driverId: drvBusy.driverId, vehicleId: vehBusy.vehicleId },
        ]);
        await tx.insert(roadRun).values({
          ...tenancy(op), state: 'started',
          assignedOperatorId: opBusy, assignedAssetId: vehBusy.vehicleId,
          startedAt: new Date(),
        });
        return { items: (await svc.vehicles(op)).items, expectedId: vehIdle.vehicleId };
      });
      expect(captured?.items).toEqual([{ id: captured?.expectedId, label: 'AAA-VIDLE-01' }]);
    });
    it('keeps a vehicle whose only road_run is completed (terminal -> free again)', async () => {
      const captured = await withTxIsolation(testDb, async (tx) => {
        const svc = new ReferenceService(tx as never);
        const op = createOperatorContext();
        const opDone = '00000000-0000-0000-0000-000000004010';
        const [drvDone] = await tx.insert(driver).values({
          ...tenancy(op), fullName: 'VDoneDrv', active: true, operatorId: opDone,
        }).returning();
        const [vehDone] = await tx.insert(vehicle).values({
          ...tenancy(op), plate: 'AAA-VDONE-01', active: true,
        }).returning();
        if (!drvDone || !vehDone) throw new Error('seed failed');
        await tx.insert(driverVehicleAssignment).values({
          ...tenancy(op), driverId: drvDone.driverId, vehicleId: vehDone.vehicleId,
        });
        await tx.insert(roadRun).values({
          ...tenancy(op), state: 'completed',
          assignedOperatorId: opDone, assignedAssetId: vehDone.vehicleId,
          startedAt: new Date(), completedAt: new Date(),
        });
        return { items: (await svc.vehicles(op)).items, expectedId: vehDone.vehicleId };
      });
      expect(captured?.items).toEqual([{ id: captured?.expectedId, label: 'AAA-VDONE-01' }]);
    });
  });
});
