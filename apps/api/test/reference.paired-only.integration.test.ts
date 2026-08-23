// apps/api/test/reference.paired-only.integration.test.ts
// PGlite integration test for the business invariant:
//   'Driver and truck must be actively assigned together.'
// Therefore ReferenceService.drivers(op) and ReferenceService.vehicles(op)
// MUST return only rows that participate in an active (not revoked)
// driver_vehicle_assignment with their counterpart also active and in the
// same tenancy. Unpaired drivers / unpaired vehicles must be excluded at the
// API source-of-truth (not just hidden client-side, which is bypassable).
//
// Discriminating shape: each test seeds BOTH a positive row (paired+valid)
// AND a negative row (the excluded case) in the same transaction. The
// assertion is performed OUTSIDE withTxIsolation by returning the captured
// result, because withTxIsolation swallows in-body errors as part of its
// rollback signaling. (assertions inside the body would be silently ignored.)
//
// Isolation: tx-injection per test via withTxIsolation.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ReferenceService } from '../src/reference/reference.service.js';
import { driver, vehicle } from '../src/database/schema/reference.js';
import { driverVehicleAssignment } from '../src/database/schema/driver-vehicle-assignment.js';
import {
  startPgliteTestDb,
  stopPgliteTestDb,
  type PgliteTestDb,
} from './helpers/pglite-test-db.js';
import { withTxIsolation } from './helpers/with-tx-isolation.js';
import { createOperatorContext } from '@fleet/test-fixtures';
let testDb: PgliteTestDb;
function tenancy(op: ReturnType<typeof createOperatorContext>): {
  companyId: string;
  businessUnitId: string;
  depotId: string;
  legalEntityId: string;
} {
  return {
    companyId: op.companyId,
    businessUnitId: op.businessUnitId,
    depotId: op.depotId,
    legalEntityId: op.legalEntityId,
  };
}
describe('@fleet/api - ReferenceService paired-only filtering (integration)', () => {
  beforeAll(async () => {
    testDb = await startPgliteTestDb();
  });
  afterAll(async () => {
    await stopPgliteTestDb(testDb);
  });
  describe('drivers(op)', () => {
    it('returns paired drivers and excludes an unpaired driver seeded alongside', async () => {
      const result = await withTxIsolation(testDb, async (tx) => {
        const svc = new ReferenceService(tx as never);
        const op = createOperatorContext();
        const opPaired = '00000000-0000-0000-0000-000000001001';
        const opUnpaired = '00000000-0000-0000-0000-000000001002';
        const [drvP] = await tx
          .insert(driver)
          .values({
            ...tenancy(op),
            fullName: 'AAA PairedDrv',
            active: true,
            operatorId: opPaired,
          })
          .returning();
        await tx.insert(driver).values({
          ...tenancy(op),
          fullName: 'BBB UnpairedDrv',
          active: true,
          operatorId: opUnpaired,
        });
        const [vehP] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(op),
            plate: 'PR-01',
            active: true,
          })
          .returning();
        if (!drvP || !vehP) throw new Error('seed failed');
        await tx.insert(driverVehicleAssignment).values({
          ...tenancy(op),
          driverId: drvP.driverId,
          vehicleId: vehP.vehicleId,
        });
        return (await svc.drivers(op)).items;
      });
      expect(result).toEqual([
        { id: '00000000-0000-0000-0000-000000001001', label: 'AAA PairedDrv' },
      ]);
    });
    it('excludes a driver whose only assignment is revoked while keeping a sibling paired driver', async () => {
      const result = await withTxIsolation(testDb, async (tx) => {
        const svc = new ReferenceService(tx as never);
        const op = createOperatorContext();
        const opOk = '00000000-0000-0000-0000-000000001010';
        const opRev = '00000000-0000-0000-0000-000000001011';
        const [drvOk] = await tx
          .insert(driver)
          .values({
            ...tenancy(op),
            fullName: 'AAA OkDrv',
            active: true,
            operatorId: opOk,
          })
          .returning();
        const [drvRev] = await tx
          .insert(driver)
          .values({
            ...tenancy(op),
            fullName: 'BBB RevDrv',
            active: true,
            operatorId: opRev,
          })
          .returning();
        const [vehOk] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(op),
            plate: 'OK-01',
            active: true,
          })
          .returning();
        const [vehRev] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(op),
            plate: 'RV-01',
            active: true,
          })
          .returning();
        if (!drvOk || !drvRev || !vehOk || !vehRev) throw new Error('seed failed');
        await tx.insert(driverVehicleAssignment).values([
          { ...tenancy(op), driverId: drvOk.driverId, vehicleId: vehOk.vehicleId },
          {
            ...tenancy(op),
            driverId: drvRev.driverId,
            vehicleId: vehRev.vehicleId,
            revokedAt: new Date(),
          },
        ]);
        return (await svc.drivers(op)).items;
      });
      expect(result).toEqual([{ id: '00000000-0000-0000-0000-000000001010', label: 'AAA OkDrv' }]);
    });
    it('excludes a driver paired only with an inactive vehicle while keeping a sibling paired driver', async () => {
      const result = await withTxIsolation(testDb, async (tx) => {
        const svc = new ReferenceService(tx as never);
        const op = createOperatorContext();
        const opOk = '00000000-0000-0000-0000-000000001020';
        const opIV = '00000000-0000-0000-0000-000000001021';
        const [drvOk] = await tx
          .insert(driver)
          .values({
            ...tenancy(op),
            fullName: 'AAA OkDrv2',
            active: true,
            operatorId: opOk,
          })
          .returning();
        const [drvIV] = await tx
          .insert(driver)
          .values({
            ...tenancy(op),
            fullName: 'BBB IVDrv',
            active: true,
            operatorId: opIV,
          })
          .returning();
        const [vehOk] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(op),
            plate: 'OK-02',
            active: true,
          })
          .returning();
        const [vehIV] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(op),
            plate: 'IV-01',
            active: false,
          })
          .returning();
        if (!drvOk || !drvIV || !vehOk || !vehIV) throw new Error('seed failed');
        await tx.insert(driverVehicleAssignment).values([
          { ...tenancy(op), driverId: drvOk.driverId, vehicleId: vehOk.vehicleId },
          { ...tenancy(op), driverId: drvIV.driverId, vehicleId: vehIV.vehicleId },
        ]);
        return (await svc.drivers(op)).items;
      });
      expect(result).toEqual([{ id: '00000000-0000-0000-0000-000000001020', label: 'AAA OkDrv2' }]);
    });
    it('excludes pairings whose joined vehicle belongs to another company while keeping in-company pair', async () => {
      const result = await withTxIsolation(testDb, async (tx) => {
        const svc = new ReferenceService(tx as never);
        const opMine = createOperatorContext();
        const opForeign = createOperatorContext();
        const opIdOk = '00000000-0000-0000-0000-000000001030';
        const opIdBad = '00000000-0000-0000-0000-000000001031';
        const [drvOk] = await tx
          .insert(driver)
          .values({
            ...tenancy(opMine),
            fullName: 'AAA OkDrv3',
            active: true,
            operatorId: opIdOk,
          })
          .returning();
        const [drvBad] = await tx
          .insert(driver)
          .values({
            ...tenancy(opMine),
            fullName: 'BBB BadDrv',
            active: true,
            operatorId: opIdBad,
          })
          .returning();
        const [vehOk] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(opMine),
            plate: 'OK-03',
            active: true,
          })
          .returning();
        const [vehForeign] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(opForeign),
            plate: 'FG-01',
            active: true,
          })
          .returning();
        if (!drvOk || !drvBad || !vehOk || !vehForeign) throw new Error('seed failed');
        await tx.insert(driverVehicleAssignment).values([
          { ...tenancy(opMine), driverId: drvOk.driverId, vehicleId: vehOk.vehicleId },
          { ...tenancy(opMine), driverId: drvBad.driverId, vehicleId: vehForeign.vehicleId },
        ]);
        return (await svc.drivers(opMine)).items;
      });
      expect(result).toEqual([{ id: '00000000-0000-0000-0000-000000001030', label: 'AAA OkDrv3' }]);
    });
  });
  describe('vehicles(op)', () => {
    it('returns paired vehicles and excludes an unpaired vehicle seeded alongside', async () => {
      const captured = await withTxIsolation(testDb, async (tx) => {
        const svc = new ReferenceService(tx as never);
        const op = createOperatorContext();
        const opP = '00000000-0000-0000-0000-000000002001';
        const [drvP] = await tx
          .insert(driver)
          .values({
            ...tenancy(op),
            fullName: 'VPairedDrv',
            active: true,
            operatorId: opP,
          })
          .returning();
        const [vehP] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(op),
            plate: 'AAA-VP-01',
            active: true,
          })
          .returning();
        await tx.insert(vehicle).values({
          ...tenancy(op),
          plate: 'BBB-VU-01',
          active: true,
        });
        if (!drvP || !vehP) throw new Error('seed failed');
        await tx.insert(driverVehicleAssignment).values({
          ...tenancy(op),
          driverId: drvP.driverId,
          vehicleId: vehP.vehicleId,
        });
        return { items: (await svc.vehicles(op)).items, expectedId: vehP.vehicleId };
      });
      expect(captured?.items).toEqual([{ id: captured?.expectedId, label: 'AAA-VP-01' }]);
    });
    it('excludes a vehicle whose only assignment is revoked while keeping a sibling paired vehicle', async () => {
      const captured = await withTxIsolation(testDb, async (tx) => {
        const svc = new ReferenceService(tx as never);
        const op = createOperatorContext();
        const opOk = '00000000-0000-0000-0000-000000002010';
        const opRev = '00000000-0000-0000-0000-000000002011';
        const [drvOk] = await tx
          .insert(driver)
          .values({
            ...tenancy(op),
            fullName: 'VOkDrv',
            active: true,
            operatorId: opOk,
          })
          .returning();
        const [drvRev] = await tx
          .insert(driver)
          .values({
            ...tenancy(op),
            fullName: 'VRevDrv',
            active: true,
            operatorId: opRev,
          })
          .returning();
        const [vehOk] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(op),
            plate: 'AAA-VOK-01',
            active: true,
          })
          .returning();
        const [vehRev] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(op),
            plate: 'BBB-VRV-01',
            active: true,
          })
          .returning();
        if (!drvOk || !drvRev || !vehOk || !vehRev) throw new Error('seed failed');
        await tx.insert(driverVehicleAssignment).values([
          { ...tenancy(op), driverId: drvOk.driverId, vehicleId: vehOk.vehicleId },
          {
            ...tenancy(op),
            driverId: drvRev.driverId,
            vehicleId: vehRev.vehicleId,
            revokedAt: new Date(),
          },
        ]);
        return { items: (await svc.vehicles(op)).items, expectedId: vehOk.vehicleId };
      });
      expect(captured?.items).toEqual([{ id: captured?.expectedId, label: 'AAA-VOK-01' }]);
    });
    it('excludes a vehicle paired only with an inactive driver while keeping a sibling paired vehicle', async () => {
      const captured = await withTxIsolation(testDb, async (tx) => {
        const svc = new ReferenceService(tx as never);
        const op = createOperatorContext();
        const opOk = '00000000-0000-0000-0000-000000002020';
        const opID = '00000000-0000-0000-0000-000000002021';
        const [drvOk] = await tx
          .insert(driver)
          .values({
            ...tenancy(op),
            fullName: 'V2OkDrv',
            active: true,
            operatorId: opOk,
          })
          .returning();
        const [drvIA] = await tx
          .insert(driver)
          .values({
            ...tenancy(op),
            fullName: 'V2InactDrv',
            active: false,
            operatorId: opID,
          })
          .returning();
        const [vehOk] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(op),
            plate: 'AAA-VOK-02',
            active: true,
          })
          .returning();
        const [vehID] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(op),
            plate: 'BBB-VID-01',
            active: true,
          })
          .returning();
        if (!drvOk || !drvIA || !vehOk || !vehID) throw new Error('seed failed');
        await tx.insert(driverVehicleAssignment).values([
          { ...tenancy(op), driverId: drvOk.driverId, vehicleId: vehOk.vehicleId },
          { ...tenancy(op), driverId: drvIA.driverId, vehicleId: vehID.vehicleId },
        ]);
        return { items: (await svc.vehicles(op)).items, expectedId: vehOk.vehicleId };
      });
      expect(captured?.items).toEqual([{ id: captured?.expectedId, label: 'AAA-VOK-02' }]);
    });
    it('excludes pairings whose joined driver belongs to another company while keeping in-company pair', async () => {
      const captured = await withTxIsolation(testDb, async (tx) => {
        const svc = new ReferenceService(tx as never);
        const opMine = createOperatorContext();
        const opForeign = createOperatorContext();
        const opIdOk = '00000000-0000-0000-0000-000000002030';
        const opIdForeign = '00000000-0000-0000-0000-000000002031';
        const [drvOk] = await tx
          .insert(driver)
          .values({
            ...tenancy(opMine),
            fullName: 'V3OkDrv',
            active: true,
            operatorId: opIdOk,
          })
          .returning();
        const [drvForeign] = await tx
          .insert(driver)
          .values({
            ...tenancy(opForeign),
            fullName: 'V3ForDrv',
            active: true,
            operatorId: opIdForeign,
          })
          .returning();
        const [vehOk] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(opMine),
            plate: 'AAA-VOK-03',
            active: true,
          })
          .returning();
        const [vehBad] = await tx
          .insert(vehicle)
          .values({
            ...tenancy(opMine),
            plate: 'BBB-VBD-01',
            active: true,
          })
          .returning();
        if (!drvOk || !drvForeign || !vehOk || !vehBad) throw new Error('seed failed');
        await tx.insert(driverVehicleAssignment).values([
          { ...tenancy(opMine), driverId: drvOk.driverId, vehicleId: vehOk.vehicleId },
          { ...tenancy(opMine), driverId: drvForeign.driverId, vehicleId: vehBad.vehicleId },
        ]);
        return { items: (await svc.vehicles(opMine)).items, expectedId: vehOk.vehicleId };
      });
      expect(captured?.items).toEqual([{ id: captured?.expectedId, label: 'AAA-VOK-03' }]);
    });
  });
});
