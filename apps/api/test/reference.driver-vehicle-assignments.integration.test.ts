// apps/api/test/reference.driver-vehicle-assignments.integration.test.ts
// PGlite integration: ReferenceService.driverVehicleAssignments(op) returns
// the active 1:1 driver↔vehicle pairings for the company as
// { operatorId, vehicleId } pairs. The dispatch form uses operatorId (not
// driverId) for the driver dropdown value, so the mapping must be exposed
// keyed on operatorId to allow bidirectional auto-fill between Số xe and
// Tài xế.
//
// Branches covered:
//   - active pair returned
//   - revoked pair excluded (revokedAt IS NOT NULL)
//   - inactive driver excluded
//   - inactive vehicle excluded
//   - driver with null operator_id excluded
//   - cross-company isolation (dva.companyId filter)
//   - cross-company isolation via joined driver/vehicle tenancy
//     (defense-in-depth: dva.companyId alone is not sufficient)
//
// Isolation: tx-injection per test (see helpers/with-tx-isolation.ts).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ReferenceService } from '../src/reference/reference.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
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
describe('@fleet/api - ReferenceService.driverVehicleAssignments (integration)', () => {
  beforeAll(async () => { testDb = await startPgliteTestDb(); });
  afterAll(async () => { await stopPgliteTestDb(testDb); });
  it('returns active pairs as { operatorId, vehicleId }', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const opAlpha = '00000000-0000-0000-0000-0000000000a1';
      const [drvAlpha] = await tx.insert(driver).values({
        ...tenancy(op), fullName: 'Alpha', active: true, operatorId: opAlpha,
      }).returning();
      const [vehAA] = await tx.insert(vehicle).values({
        ...tenancy(op), plate: 'AA-01', active: true,
      }).returning();
      if (!drvAlpha || !vehAA) throw new Error('seed failed');
      await tx.insert(driverVehicleAssignment).values({
        ...tenancy(op), driverId: drvAlpha.driverId, vehicleId: vehAA.vehicleId,
      });
      const res = await svc.driverVehicleAssignments(op);
      expect(res.items).toEqual([{ operatorId: opAlpha, vehicleId: vehAA.vehicleId }]);
    });
  });
  it('excludes revoked assignments', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const opR = '00000000-0000-0000-0000-0000000000b2';
      const [drvR] = await tx.insert(driver).values({
        ...tenancy(op), fullName: 'Revoked', active: true, operatorId: opR,
      }).returning();
      const [vehR] = await tx.insert(vehicle).values({
        ...tenancy(op), plate: 'BB-02', active: true,
      }).returning();
      if (!drvR || !vehR) throw new Error('seed failed');
      await tx.insert(driverVehicleAssignment).values({
        ...tenancy(op), driverId: drvR.driverId, vehicleId: vehR.vehicleId,
        revokedAt: new Date(),
      });
      const res = await svc.driverVehicleAssignments(op);
      expect(res.items).toEqual([]);
    });
  });
  it('excludes pairs whose driver is inactive', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const opX = '00000000-0000-0000-0000-0000000000c3';
      const [drvX] = await tx.insert(driver).values({
        ...tenancy(op), fullName: 'InactiveDrv', active: false, operatorId: opX,
      }).returning();
      const [vehX] = await tx.insert(vehicle).values({
        ...tenancy(op), plate: 'CC-03', active: true,
      }).returning();
      if (!drvX || !vehX) throw new Error('seed failed');
      await tx.insert(driverVehicleAssignment).values({
        ...tenancy(op), driverId: drvX.driverId, vehicleId: vehX.vehicleId,
      });
      const res = await svc.driverVehicleAssignments(op);
      expect(res.items).toEqual([]);
    });
  });
  it('excludes pairs whose vehicle is inactive', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const opY = '00000000-0000-0000-0000-0000000000d4';
      const [drvY] = await tx.insert(driver).values({
        ...tenancy(op), fullName: 'OkDrv', active: true, operatorId: opY,
      }).returning();
      const [vehY] = await tx.insert(vehicle).values({
        ...tenancy(op), plate: 'DD-04', active: false,
      }).returning();
      if (!drvY || !vehY) throw new Error('seed failed');
      await tx.insert(driverVehicleAssignment).values({
        ...tenancy(op), driverId: drvY.driverId, vehicleId: vehY.vehicleId,
      });
      const res = await svc.driverVehicleAssignments(op);
      expect(res.items).toEqual([]);
    });
  });
  it('excludes drivers whose operator_id is null', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op = createOperatorContext();
      const [drvN] = await tx.insert(driver).values({
        ...tenancy(op), fullName: 'NoOp', active: true, operatorId: null,
      }).returning();
      const [vehN] = await tx.insert(vehicle).values({
        ...tenancy(op), plate: 'EE-05', active: true,
      }).returning();
      if (!drvN || !vehN) throw new Error('seed failed');
      await tx.insert(driverVehicleAssignment).values({
        ...tenancy(op), driverId: drvN.driverId, vehicleId: vehN.vehicleId,
      });
      const res = await svc.driverVehicleAssignments(op);
      expect(res.items).toEqual([]);
    });
  });
  it('isolates by company_id', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const op1 = createOperatorContext();
      const op2 = createOperatorContext();
      const opMine = '00000000-0000-0000-0000-0000000000f6';
      const opOther = '00000000-0000-0000-0000-0000000000f7';
      const [drvMine] = await tx.insert(driver).values({
        ...tenancy(op1), fullName: 'Mine', active: true, operatorId: opMine,
      }).returning();
      const [vehMine] = await tx.insert(vehicle).values({
        ...tenancy(op1), plate: 'FF-06', active: true,
      }).returning();
      const [drvOther] = await tx.insert(driver).values({
        ...tenancy(op2), fullName: 'Other', active: true, operatorId: opOther,
      }).returning();
      const [vehOther] = await tx.insert(vehicle).values({
        ...tenancy(op2), plate: 'GG-07', active: true,
      }).returning();
      if (!drvMine || !vehMine || !drvOther || !vehOther) throw new Error('seed failed');
      await tx.insert(driverVehicleAssignment).values([
        { ...tenancy(op1), driverId: drvMine.driverId, vehicleId: vehMine.vehicleId },
        { ...tenancy(op2), driverId: drvOther.driverId, vehicleId: vehOther.vehicleId },
      ]);
      const res = await svc.driverVehicleAssignments(op1);
      expect(res.items).toEqual([{ operatorId: opMine, vehicleId: vehMine.vehicleId }]);
    });
  });
  it('excludes assignments whose joined driver or vehicle belongs to another company (defense-in-depth)', async () => {
    await withTxIsolation(testDb, async (tx) => {
      const svc = new ReferenceService(tx as never);
      const opMine = createOperatorContext();
      const opForeign = createOperatorContext();
      const opIdForeign = '00000000-0000-0000-0000-000000000a99';
      const [drvForeign] = await tx.insert(driver).values({
        ...tenancy(opForeign), fullName: 'ForeignDriver', active: true, operatorId: opIdForeign,
      }).returning();
      const [vehForeign] = await tx.insert(vehicle).values({
        ...tenancy(opForeign), plate: 'XX-99', active: true,
      }).returning();
      if (!drvForeign || !vehForeign) throw new Error('seed failed');
      await tx.insert(driverVehicleAssignment).values({
        ...tenancy(opMine),
        driverId: drvForeign.driverId,
        vehicleId: vehForeign.vehicleId,
      });
      const res = await svc.driverVehicleAssignments(opMine);
      expect(res.items).toEqual([]);
    });
  });
});
